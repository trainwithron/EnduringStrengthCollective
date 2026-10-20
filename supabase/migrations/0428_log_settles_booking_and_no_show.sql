-- FIX 3 item 4 (docs/build-orders-oct19/FIX3_SESSIONS_AND_PACKAGES.md). Ron, Oct 19: "If I log a session, at the same time that a client is on my schedule, we can assume that that client
-- attended ... Or just after it happened, it should prompt me, did this person come in? Did they reschedule?" Every booking ends as happened, no-show or late change, and no visit ever
-- takes two sessions.
--   1. match_booking_for_session(session): the client's session on the coach's calendar the same day (coach's time zone) that a logged workout belongs to; links it. Internal.
--   2. complete_workout_session: a workout the coach logs settles its booking (linked at Start, or matched now) ONCE. The old "Use 1 session credit" choice is gone (the column stays).
--      No booking: nothing is taken; the app asks "Put this on your calendar?" (create_walk_in_booking).
--   3. resolve_no_show(booking, charge): marks a past session a no-show; Charge uses 1 session (nothing more when it was paid at booking), Waive uses none (gives back one paid at booking).
--   4. set_booking_no_show: true = a no-show, waived; false = back to an ordinary session, giving back only what the no-show took.
--   5. resolve_late_change: a charge is a session USED ('delivered'). A late MOVE is ONE session (Ron: "that should only be one session"): unpaid, the charge is that session (settled,
--      so when it happens nothing more is taken); paid at booking, nothing more.
--   6. cancel_booking_and_refund_credit: a late move the coach charged and the client then cancels: no refund, not flagged again. A coach cancelling it gives the session back (as before).
--   7. undo_booking_attended: gives back only what attendance took; a late-move charge stays.
--   8. create_walk_in_booking(session): Yes on the walk-in prompt. A booking from the workout's start to the later of its finish and one session's length, its own overlap check, settled once.
-- A late charge is recognised by its ledger note (written only by resolve_late_change below): booking_late_charge_taken(booking).

-- ---- the late charge on a booking --------------------------------------------------------------------------------------------------------
create or replace function public.booking_late_charge_taken(p_booking_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(-sum(l.amount), 0)::int
  from public.session_credit_ledger l
  where l.booking_id = p_booking_id
    and l.kind = 'delivered'
    and l.note in ('Late reschedule, charged by your coach', 'Late cancellation, charged by your coach');
$$;
revoke all on function public.booking_late_charge_taken(uuid) from public, anon, authenticated;

-- ---- 1. the booking a logged workout belongs to ---------------------------------------------------------------------------------------------
-- Same client, same group, confirmed, not a no-show, not already linked to another logged workout, on the same calendar day as the workout's start in the booking coach's time zone. Several: the logging
-- coach's own first, then the nearest start. Whatever its credit state: settling takes a session only from an unpaid one, so a session paid at booking or a late move already charged
-- is settled with nothing more taken (and is never offered as a walk-in on top).
create or replace function public.match_booking_for_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.athlete_sessions%rowtype;
  v_id uuid;
begin
  select * into v_s from public.athlete_sessions where id = p_session_id for update;
  if not found then
    return null;
  end if;
  if v_s.booking_id is not null then
    return v_s.booking_id;
  end if;
  if v_s.athlete_id is null or v_s.group_id is null or v_s.started_at is null then
    return null;
  end if;

  select b.id into v_id
  from public.bookings b
  where b.athlete_id = v_s.athlete_id
    and b.group_id = v_s.group_id
    and b.status = 'confirmed'
    and not b.no_show
    -- Not yet marked happened, or marked happened ("Did it happen? Yes") with no workout logged for it yet: linking that one takes nothing more and keeps the app from
    -- offering the same visit as a walk-in.
    and (b.attended_at is null
         or not exists (select 1 from public.athlete_sessions o where o.booking_id = b.id and o.id <> p_session_id))
    and (b.start_at at time zone coalesce(public.coach_time_zone(b.coach_id), 'America/New_York'))::date
        = (v_s.started_at at time zone coalesce(public.coach_time_zone(b.coach_id), 'America/New_York'))::date
  order by (b.attended_at is null) desc, coalesce(b.coach_id = auth.uid(), false) desc, abs(extract(epoch from (b.start_at - v_s.started_at))), b.id
  limit 1
  for update of b;

  if v_id is not null then
    update public.athlete_sessions set booking_id = v_id where id = p_session_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.match_booking_for_session(uuid) from public, anon, authenticated;

-- ---- 2. complete_workout_session: logging settles the booking once ------------------------------------------------------------------------
-- The function is large and unrelated to this change, so (the 0231 pattern) the live text is read back and ONE block is replaced: from its first line to the line before the final
-- "return query". Both anchors must appear exactly once, and the step's precheck has already confirmed the whole live function is the exact version this was written against.
do $$
declare
  v_def text;
  v_from text := 'if v_session.logged_by_coach and v_session.booking_id is not null then';
  v_to text := 'return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets';
  v_start int;
  v_end int;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = 'public.complete_workout_session(uuid)'::regprocedure;
  if (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1
     or (length(v_def) - length(replace(v_def, v_to, ''))) / length(v_to) <> 1 then
    raise exception 'complete_workout_session: the credit block was not found exactly once; nothing was changed';
  end if;
  v_start := position(v_from in v_def);
  v_end := position(v_to in v_def);
  if v_end <= v_start then
    raise exception 'complete_workout_session: the credit block is not where it was expected; nothing was changed';
  end if;
  v_def := substr(v_def, 1, v_start - 1)
    || 'if v_session.logged_by_coach then' || chr(10)
    || '    -- FIX 3 (0428): the session this workout belongs to (linked at Start, or that client''s session on the calendar the same day) is settled ONCE: settle_booking_internal never' || chr(10)
    || '    -- takes a second session. No booking: nothing is taken here; the app offers it as a walk-in (create_walk_in_booking). The old "Use 1 session credit" choice is gone.' || chr(10)
    || '    v_credit_consumed := public.settle_booking_internal(coalesce(v_session.booking_id, public.match_booking_for_session(p_session_id)), v_credit_cost, ''Workout logged'', auth.uid(), v_session.athlete_id, v_session.group_id);' || chr(10)
    || '  end if;' || chr(10)
    || chr(10)
    || '  '
    || substr(v_def, v_end);
  execute v_def;
end $$;

-- ---- 3. a no-show: Charge or Waive -----------------------------------------------------------------------------------------------------------
create or replace function public.resolve_no_show(p_booking_id uuid, p_charge boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  -- The booking's own coach decides (or an owner or admin of the organization), as for a late change.
  if auth.role() is distinct from 'service_role'
     and not ((v_b.coach_id = auth.uid() and public.is_group_coach(v_b.group_id)) or public.is_org_admin_of_group(v_b.group_id)) then
    raise exception 'not authorized';
  end if;
  if v_b.status <> 'confirmed' then
    raise exception 'only a confirmed session can be a no-show';
  end if;
  if v_b.start_at > now() then
    raise exception 'this session has not started yet';
  end if;
  if v_b.attended_at is not null then
    raise exception 'this session was marked as happened; undo that first';
  end if;
  if v_b.no_show then
    raise exception 'this session is already a no-show';
  end if;

  update public.bookings set no_show = true where id = p_booking_id;

  -- A late move the coach already charged IS this visit's one session (Ron: "one session"): nothing more either way.
  if v_b.late_change_kind = 'reschedule' and v_b.late_charge_state = 'charged' then
    return false;
  end if;

  if p_charge then
    if v_b.credit_state in ('unsettled', 'waived') then
      perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, -1, 'delivered', 'No-show, charged', p_booking_id, auth.uid());
      update public.bookings set credit_state = 'settled' where id = p_booking_id;
      return true;
    end if;
    return false; -- paid when it was booked (or already settled): nothing more
  end if;

  if v_b.credit_state = 'unsettled' then
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, 0, 'waived', 'No-show, not charged', p_booking_id, auth.uid());
    update public.bookings set credit_state = 'waived' where id = p_booking_id;
  elsif v_b.credit_state = 'prepaid' then
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, 1, 'refund', 'No-show, not charged', p_booking_id, auth.uid());
    update public.bookings set credit_state = 'waived' where id = p_booking_id;
  end if;
  return false;
end;
$$;
revoke all on function public.resolve_no_show(uuid, boolean) from public, anon;
grant execute on function public.resolve_no_show(uuid, boolean) to authenticated, service_role;

-- ---- 4. set_booking_no_show: true = a waived no-show; false = undo, giving back only what the no-show took ------------------------------------
create or replace function public.set_booking_no_show(p_booking_id uuid, p_no_show boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
  v_taken int;
  v_late int;
begin
  if p_no_show then
    perform public.resolve_no_show(p_booking_id, false);
    return;
  end if;

  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if auth.role() is distinct from 'service_role'
     and not ((v_b.coach_id = auth.uid() and public.is_group_coach(v_b.group_id)) or public.is_org_admin_of_group(v_b.group_id)) then
    raise exception 'not authorized';
  end if;
  if v_b.status <> 'confirmed' then
    raise exception 'only a confirmed booking can be marked';
  end if;
  if not v_b.no_show then
    return;
  end if;

  if v_b.credit_state = 'settled' then
    -- What this booking has cost so far (delivered minus refunds, the undo_booking_attended formula), less a late-move charge, which stays.
    v_late := public.booking_late_charge_taken(p_booking_id);
    select coalesce(-sum(amount), 0) - v_late into v_taken
    from public.session_credit_ledger
    where booking_id = p_booking_id and kind in ('delivered', 'refund');
    if v_taken > 0 then
      perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, v_taken, 'refund', 'Undid no-show', p_booking_id, auth.uid());
    end if;
    update public.bookings set no_show = false, credit_state = case when v_late > 0 then 'settled' else 'unsettled' end where id = p_booking_id;
  elsif v_b.credit_state = 'waived'
        and exists (select 1 from public.session_credit_ledger where booking_id = p_booking_id and note = 'No-show, not charged') then
    -- Waived by the no-show (a session paid at booking was given back then): an ordinary unpaid session again.
    update public.bookings set no_show = false, credit_state = 'unsettled' where id = p_booking_id;
  else
    update public.bookings set no_show = false where id = p_booking_id;
  end if;
end;
$$;
revoke all on function public.set_booking_no_show(uuid, boolean) from public, anon;
grant execute on function public.set_booking_no_show(uuid, boolean) to authenticated, service_role;

-- ---- 5. resolve_late_change: a charge is a session used; a late move is ONE session --------------------------------------------------------------
create or replace function public.resolve_late_change(p_booking_id uuid, p_charge boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_state text;
  v_kind text;
  v_credit_state text;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select athlete_id, group_id, coach_id, late_charge_state, late_change_kind, credit_state
    into v_athlete_id, v_group_id, v_coach_id, v_state, v_kind, v_credit_state
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  -- The booking's own coach decides (or an owner or admin of the organization), not just any coach of the group.
  if auth.role() is distinct from 'service_role'
     and not ((v_coach_id = auth.uid() and public.is_group_coach(v_group_id)) or public.is_org_admin_of_group(v_group_id)) then
    raise exception 'not authorized';
  end if;
  if v_state is distinct from 'flagged' then
    raise exception 'this change is not waiting for a decision';
  end if;

  if p_charge then
    if v_kind = 'reschedule' then
      -- ONE session for a late move (Ron, Oct 19). Unpaid: this charge is that session, so the booking is settled and nothing more is taken when it happens.
      -- Paid when it was booked, or already settled: nothing more.
      if v_credit_state in ('unsettled', 'waived') then
        perform public.apply_session_credit_change(v_athlete_id, v_group_id, -1, 'delivered', 'Late reschedule, charged by your coach', p_booking_id, auth.uid());
        update public.bookings set credit_state = 'settled' where id = p_booking_id;
      end if;
    else
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, -1, 'delivered', 'Late cancellation, charged by your coach', p_booking_id, auth.uid());
    end if;
    update public.bookings set late_charge_state = 'charged' where id = p_booking_id;
  else
    update public.bookings set late_charge_state = 'waived' where id = p_booking_id;
  end if;
end;
$$;
revoke all on function public.resolve_late_change(uuid, boolean) from public, anon;
grant execute on function public.resolve_late_change(uuid, boolean) to authenticated, service_role;

-- ---- 6. cancel_booking_and_refund_credit: a charged late move cancelled by the client gives nothing back ---------------------------------------------
-- The live text (0291) with one block added after the "already started" check.
create or replace function public.cancel_booking_and_refund_credit(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_state text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_attended_at timestamptz;
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
  v_late boolean := false;
  v_athlete_name text;
  v_late_kind text;
  v_late_state text;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to cancel this booking';
  end if;

  select athlete_id, group_id, coach_id, status, credit_state, start_at, end_at, attended_at, late_change_kind, late_charge_state
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_state, v_start_at, v_end_at, v_attended_at, v_late_kind, v_late_state
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id and not public.is_group_coach(v_group_id) then
    raise exception 'not authorized to cancel this booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a cancellable state';
  end if;

  v_is_athlete_cancelling := auth.uid() = v_athlete_id;

  -- A client cannot cancel a session that has started or was already marked attended (that would hand back a credit for a session that happened).
  if v_is_athlete_cancelling and not coalesce(public.is_group_coach(v_group_id), false)
     and (v_attended_at is not null or v_start_at <= now()) then
    raise exception 'this session has already started; ask your coach';
  end if;

  -- FIX 3 (0428): a late move the coach charged is this visit's one session. The client cancelling it afterwards gets nothing back and it is not flagged again.
  -- (A coach cancelling it gives the session back below, as any coach cancellation does.)
  if v_is_athlete_cancelling and not coalesce(public.is_group_coach(v_group_id), false)
     and v_late_kind = 'reschedule' and v_late_state = 'charged' then
    update public.bookings set status = 'cancelled' where id = p_booking_id;
    perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
    return;
  end if;

  if v_is_athlete_cancelling then
    select coalesce(
      (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
      24
    ) into v_window_hours;
    v_should_refund := (v_start_at - now()) >= make_interval(hours => v_window_hours);
  else
    v_should_refund := true;
  end if;

  -- A session the coach already waived (credit_state 'waived') is never flagged: they chose not to charge it.
  v_late := v_is_athlete_cancelling and not v_should_refund and v_state in ('prepaid', 'settled', 'unsettled');

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  if v_late then
    -- A client cancelling inside the window is FLAGGED for the coach, who decides whether it counts (Charge or Waive). Nothing is taken
    -- automatically: a credit already taken at booking is given back, and the coach can take it again with Charge.
    update public.bookings
      set late_cancel = true, late_change_kind = 'cancel', late_charge_state = 'flagged'
      where id = p_booking_id;
    if v_state in ('prepaid', 'settled') then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, 1, 'refund', 'Booking cancelled inside the window; your coach decides if it counts', p_booking_id, auth.uid());
    end if;
    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach_id, v_group_id, 'late_change',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A client') || ' cancelled a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  elsif v_state in ('prepaid', 'settled') then
    -- A credit was taken for this booking and the cancellation is in time (or made by the coach): it comes back.
    if v_should_refund then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, 1, 'refund', 'Booking cancelled', p_booking_id, auth.uid());
    end if;
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$$;
revoke all on function public.cancel_booking_and_refund_credit(uuid) from public, anon;
grant execute on function public.cancel_booking_and_refund_credit(uuid) to authenticated, service_role;

-- ---- 7. undo_booking_attended: gives back only what attendance took ------------------------------------------------------------------------------
create or replace function public.undo_booking_attended(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
  v_taken int;
  v_late int;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if auth.role() is distinct from 'service_role' and (auth.uid() is null or not public.is_group_coach(v_b.group_id)) then
    raise exception 'not authorized to change this session';
  end if;
  if v_b.attended_at is null or v_b.status <> 'confirmed' then
    return false;
  end if;

  if v_b.credit_state = 'settled' then
    -- What this booking has actually cost the client so far: every delivered entry minus every refund already given
    -- back for it (an earlier undo, a cancellation). Refunding anything more would mint credits, so a repeated
    -- settle and undo can only ever return what is outstanding. lib/session-ledger.ts outstandingForBooking mirrors this.
    -- FIX 3 (0428): a late-move charge is not attendance's to give back: it stays, and the booking stays settled by it.
    v_late := public.booking_late_charge_taken(p_booking_id);
    select coalesce(-sum(amount), 0) - v_late into v_taken
    from public.session_credit_ledger
    where booking_id = p_booking_id and kind in ('delivered', 'refund');
    if v_taken > 0 then
      perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, v_taken, 'refund', 'Undid attended', p_booking_id, auth.uid());
    end if;
    update public.bookings set credit_state = case when v_late > 0 then 'settled' else 'unsettled' end, attended_at = null where id = p_booking_id;
  else
    update public.bookings set attended_at = null where id = p_booking_id;
  end if;
  return true;
end;
$$;
revoke all on function public.undo_booking_attended(uuid) from public, anon;
grant execute on function public.undo_booking_attended(uuid) to authenticated, service_role;

-- ---- 8. a walk-in: "Put this on your calendar? Uses 1 session." ----------------------------------------------------------------------------------
-- Ron, Oct 19: "If I do a walk-in, and I pull up their program and we do it real quick. Then it should prompt me maybe after to do you want to assign to the last hour of your calendar".
-- Yes: a confirmed booking on the logging coach's calendar from the workout's start to the later of its finish and one session's length (the coach's session length for that time,
-- else any of theirs, else 60 minutes), settled once. A workout already on the calendar is never charged again (its booking is returned). Overlapping another session: refused, nothing taken.
create or replace function public.create_walk_in_booking(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.athlete_sessions%rowtype;
  v_coach uuid := auth.uid();
  v_tz text;
  v_local timestamp;
  v_minutes int;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
begin
  if v_coach is null then
    raise exception 'not authorized';
  end if;
  select * into v_s from public.athlete_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session not found';
  end if;
  if not public.is_group_coach(v_s.group_id) then
    raise exception 'not authorized';
  end if;
  if not coalesce(v_s.logged_by_coach, false) or v_s.athlete_id is null then
    raise exception 'only a workout a coach logged for a client can be added as a walk-in';
  end if;
  if v_s.status::text <> 'completed' or v_s.started_at is null then
    raise exception 'finish the workout first';
  end if;

  -- Already on the calendar (linked, or a same-day session found now): that session, settled once; never a second one.
  v_id := coalesce(v_s.booking_id, public.match_booking_for_session(p_session_id));
  if v_id is not null then
    perform public.settle_booking_internal(v_id, 1, 'Workout logged', v_coach, v_s.athlete_id, v_s.group_id);
    return v_id;
  end if;

  v_tz := coalesce(public.coach_time_zone(v_coach), 'America/New_York');
  v_local := v_s.started_at at time zone v_tz;
  select w.session_minutes into v_minutes
  from public.coach_availability_windows w
  where w.coach_id = v_coach and w.session_minutes > 0
  order by (w.weekday = extract(dow from v_local)::int and w.start_time <= v_local::time and w.end_time > v_local::time) desc, w.weekday, w.start_time
  limit 1;

  v_start := v_s.started_at;
  v_end := greatest(coalesce(v_s.completed_at, now()), v_start + make_interval(mins => coalesce(v_minutes, 60)));

  -- Its own overlap check: the booking trigger skips a session that is already over. The same per-coach lock as that trigger.
  perform pg_advisory_xact_lock(hashtextextended('booking:' || v_coach::text, 0));
  if exists (
    select 1 from public.bookings b
    where b.coach_id = v_coach and b.status = 'confirmed' and b.start_at < v_end and b.end_at > v_start
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = v_coach and d.status = 'confirmed' and d.start_at < v_end and d.end_at > v_start
  ) then
    raise exception 'that time overlaps another session on your calendar, so it was not added and no session was used';
  end if;

  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state, booked_via)
  values (v_coach, v_s.athlete_id, v_s.group_id, v_start, v_end, 'confirmed', 'unsettled', 'coach')
  returning id into v_id;
  update public.athlete_sessions set booking_id = v_id where id = p_session_id;
  perform public.settle_booking_internal(v_id, 1, 'Walk-in', v_coach, v_s.athlete_id, v_s.group_id);
  return v_id;
end;
$$;
revoke all on function public.create_walk_in_booking(uuid) from public, anon;
grant execute on function public.create_walk_in_booking(uuid) to authenticated, service_role;
