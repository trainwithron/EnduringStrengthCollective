-- STEP 180: 0428 FIX 3: logging settles the session on the calendar once; no-show Charge or Waive; a late move is one session; the walk-in (two new functions, four helpers, seven replaced)
--
-- !! This REPLACES seven functions: complete_workout_session (ONE block, the credit block at the end, read back from the live text between two exact lines, as 0231 did, plus one declared variable; everything else in it is untouched), settle_booking_internal (one check added: never on a no-show), guard_athlete_session_columns (keeps the calendar link made while finishing; a client cannot move a coach-logged workout's start, import mark or finish), set_booking_no_show, resolve_late_change, cancel_booking_and_refund_credit (one block added) and undo_booking_attended. It adds resolve_no_show, create_walk_in_booking and four internal helpers (match_booking_for_session, booking_taken, booking_late_move_charged, booking_put_back). The paste checks that every one of the seven is exactly the text this was written against, and stops if not. Rehearsed: no visit ever takes two sessions, in any order of marks and undos.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Safe before the FIX 3 item 4 app update: today's screens keep working (Did it happen? No still cancels; the day page's no-show switch now records a waived no-show). A workout a coach logs now settles that client's session on the calendar the same day once, even when it was not linked at Start, and the old 'Use 1 session credit' box no longer takes anything. Then the app update goes live: No-show asks Charge or Waive, and a logged workout with no session on the calendar asks 'Put this on your calendar? Uses 1 session.'
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not (to_regprocedure('public.resolve_no_show(uuid, boolean)') is not null))) then
    raise exception 'Step 180 (0428) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0428_log_settles_booking_and_no_show.sql
-- ====================================================================================================

-- FIX 3 item 4 (docs/build-orders-oct19/FIX3_SESSIONS_AND_PACKAGES.md). Ron, Oct 19: "If I log a session, at the same time that a client is on my schedule, we can assume that that client
-- attended ... Or just after it happened, it should prompt me, did this person come in? Did they reschedule?" Every booking ends as happened, no-show or late change, and no visit ever
-- takes two sessions.
--   1. match_booking_for_session(session): the client's session on the coach's calendar the same day (coach's time zone) that a logged workout belongs to; links it. Internal.
--   2. complete_workout_session: a workout the coach logs settles its booking (linked at Start, or matched now) ONCE. The old "Use 1 session credit" box is gone from the app (a workout
--      started with it ticked before the update, on no session of the calendar, still takes its one session).
--      No booking: nothing is taken; the app asks "Put this on your calendar?" (create_walk_in_booking).
--   3. resolve_no_show(booking, charge): marks a past session a no-show; Charge uses 1 session (nothing more when it was paid at booking), Waive uses none (gives back one paid at booking).
--   4. set_booking_no_show: true = a no-show, waived; false = back to an ordinary session, giving back only what the no-show took.
--   5. resolve_late_change: a charge is a session USED ('delivered'). A late MOVE is ONE session (Ron: "that should only be one session"): unpaid, the charge is that session (settled,
--      so when it happens nothing more is taken); paid at booking, nothing more.
--   6. cancel_booking_and_refund_credit: a late move the coach charged and the client then cancels: no refund, not flagged again. A coach cancelling it gives the session back (as before).
--   7. undo_booking_attended: gives back only what attendance took; a late-move charge stays.
--   8. create_walk_in_booking(session): Yes on the walk-in prompt. A booking from the workout's start to the later of its finish and one session's length, its own overlap check, settled once.
--   9. settle_booking_internal: a session marked a no-show is never marked happened (undo the no-show first).
--  10. guard_athlete_session_columns: the link match_booking_for_session makes is kept when the client finishes a coach-started workout; on a workout a coach logged, the client
--      cannot move its start, mark it imported, or change when it finished.
-- Every Undo (attended, no-show) puts the booking back to what an UNMARKED visit costs, read from its own history (booking_put_back), so undos in any order can never take
-- two sessions for one visit or give back more than was taken. A late move the coach charged is recorded in the history (a 0 entry when nothing more was taken), so it stays
-- the one session whatever happens after it.

-- ---- what a booking has cost, and its late-move charge -----------------------------------------------------------------------------------------
-- Everything this booking has actually taken: taken at booking, used, given back (a 0 'waived' entry takes nothing).
create or replace function public.booking_taken(p_booking_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(-sum(l.amount), 0)::int
  from public.session_credit_ledger l
  where l.booking_id = p_booking_id and l.kind in ('booked', 'delivered', 'refund', 'adjusted');
$$;
revoke all on function public.booking_taken(uuid) from public, anon, authenticated;

-- The coach charged a late move of this booking (written only by resolve_late_change below; a 0 entry when the booking had already been paid for).
create or replace function public.booking_late_move_charged(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.session_credit_ledger l where l.booking_id = p_booking_id and l.kind = 'delivered' and l.note = 'Late reschedule, charged by your coach');
$$;
revoke all on function public.booking_late_move_charged(uuid) from public, anon, authenticated;

-- Puts a booking back to what an unmarked visit costs: ONE session when the coach charged a late move of it or it was paid for when it was booked, otherwise none (left
-- 'waived' when the coach waived it with Waive session). Gives back, or takes, only the difference from what it has actually taken. Returns the credit state it leaves.
create or replace function public.booking_put_back(p_booking_id uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
  v_paid boolean;
  v_target int;
  v_diff int;
  v_state text;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  v_paid := exists (select 1 from public.session_credit_ledger l where l.booking_id = p_booking_id and l.kind = 'booked' and l.amount < 0);
  v_target := case when public.booking_late_move_charged(p_booking_id) or v_paid then 1 else 0 end;
  v_state := case
    when v_target = 1 and v_paid then 'prepaid'
    when v_target = 1 then 'settled'
    when exists (select 1 from public.session_credit_ledger l where l.booking_id = p_booking_id and l.kind = 'waived' and l.note is distinct from 'No-show, not charged') then 'waived'
    else 'unsettled'
  end;
  v_diff := public.booking_taken(p_booking_id) - v_target;
  if v_diff > 0 then
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, v_diff, 'refund', p_note, p_booking_id, auth.uid());
  elsif v_diff < 0 then
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, v_diff, 'delivered', p_note, p_booking_id, auth.uid());
  end if;
  update public.bookings set credit_state = v_state where id = p_booking_id;
  return v_state;
end;
$$;
revoke all on function public.booking_put_back(uuid, text) from public, anon, authenticated;

-- ---- 9. settle_booking_internal: never on a no-show ----------------------------------------------------------------------------------------------
-- The live text (0282) with one check added: a session marked a no-show is not marked happened (and so never charged as happened on top of its no-show).
create or replace function public.settle_booking_internal(p_booking_id uuid, p_cost integer, p_note text, p_by uuid, p_expected_athlete uuid default null, p_expected_group uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or v_b.status <> 'confirmed' then
    return false;
  end if;
  -- A logged session may only settle a booking that is really that client's, in that group.
  if (p_expected_athlete is not null and v_b.athlete_id <> p_expected_athlete)
     or (p_expected_group is not null and v_b.group_id <> p_expected_group) then
    return false;
  end if;
  if v_b.attended_at is not null then
    return false; -- already settled by the other path; never charged twice
  end if;
  if v_b.no_show then
    return false; -- FIX 3 (0428): a no-show is settled by its own Charge or Waive; undo the no-show to mark it happened
  end if;

  update public.bookings set attended_at = now() where id = p_booking_id;

  if v_b.credit_state = 'unsettled' and coalesce(p_cost, 1) > 0 then
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, -coalesce(p_cost, 1), 'delivered', p_note, p_booking_id, p_by);
    update public.bookings set credit_state = 'settled' where id = p_booking_id;
    return true;
  end if;
  return false; -- prepaid or waived: attended, nothing more to take
end;
$$;
revoke all on function public.settle_booking_internal(uuid, integer, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---- 1. the booking a logged workout belongs to ---------------------------------------------------------------------------------------------
-- Same client, same group, confirmed, not a no-show, not already linked to another logged workout, on the same calendar day as the workout's start in the booking coach's time zone, and not
-- starting more than an hour after the workout finished. Several: the logging coach's own first, then the nearest start. Whatever its credit state: settling takes a session only from an unpaid one, so a session paid at booking or a late move already charged
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
    -- Never a session later that day (a morning workout does not use the evening session); a session up to an hour after the finish still counts (logged early).
    and b.start_at <= coalesce(v_s.completed_at, now()) + interval '60 minutes'
  order by coalesce(b.coach_id = auth.uid(), false) desc, abs(extract(epoch from (b.start_at - v_s.started_at))), (b.attended_at is null) desc, b.id
  limit 1
  for update of b;

  if v_id is not null then
    -- When the client finishes a workout the coach started, the column guard would undo this link; this flag (set only here, for this one update) lets it stay.
    perform set_config('app.fix3_match_link', '1', true);
    update public.athlete_sessions set booking_id = v_id where id = p_session_id;
    perform set_config('app.fix3_match_link', '', true);
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
  v_decl text := 'v_credit_cost int;';
  v_to text := 'return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets';
  v_start int;
  v_end int;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = 'public.complete_workout_session(uuid)'::regprocedure;
  if (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1
     or (length(v_def) - length(replace(v_def, v_to, ''))) / length(v_to) <> 1
     or (length(v_def) - length(replace(v_def, v_decl, ''))) / length(v_decl) <> 1 then
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
    || '    -- An imported workout (a team sheet, imported history) is never matched to the calendar.' || chr(10)
    || '    v_bid := coalesce(v_session.booking_id, case when v_session.import_batch_id is null and not coalesce(v_session.is_historical, false) then public.match_booking_for_session(p_session_id) end);' || chr(10)
    || '    v_credit_consumed := public.settle_booking_internal(v_bid, v_credit_cost, ''Workout logged'', auth.uid(), v_session.athlete_id, v_session.group_id);' || chr(10)
    || '    -- Started with the old box ticked (before the app update) and on NO session of the calendar: its one session, as that box promised.' || chr(10)
    || '    if not v_credit_consumed and v_bid is null and v_session.deduct_session_credit then' || chr(10)
    || '      perform public.apply_session_credit_change(v_session.athlete_id, v_session.group_id, -v_credit_cost, ''delivered'', ''Workout logged'', null, auth.uid());' || chr(10)
    || '      v_credit_consumed := true;' || chr(10)
    || '    end if;' || chr(10)
    || '  end if;' || chr(10)
    || chr(10)
    || '  '
    || substr(v_def, v_end);
  v_def := replace(v_def, v_decl, v_decl || chr(10) || '  v_bid uuid;');
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
  if public.booking_late_move_charged(p_booking_id) then
    return false;
  end if;

  if p_charge then
    if v_b.credit_state in ('unsettled', 'waived') then
      perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, -1, 'delivered', 'No-show, charged', p_booking_id, auth.uid());
      update public.bookings set credit_state = 'settled' where id = p_booking_id;
      return true;
    end if;
    return false; -- paid when it was booked: nothing more
  end if;

  if v_b.credit_state = 'unsettled' then
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, 0, 'waived', 'No-show, not charged', p_booking_id, auth.uid());
    update public.bookings set credit_state = 'waived' where id = p_booking_id;
  elsif v_b.credit_state = 'prepaid' and public.booking_taken(p_booking_id) > 0 then
    -- Paid when it was booked: what it actually took comes back (never more). A 'prepaid' booking that took nothing stays as it is.
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, public.booking_taken(p_booking_id), 'refund', 'No-show, not charged', p_booking_id, auth.uid());
    update public.bookings set credit_state = 'waived' where id = p_booking_id;
  end if;
  return false;
end;
$$;
revoke all on function public.resolve_no_show(uuid, boolean) from public, anon;
grant execute on function public.resolve_no_show(uuid, boolean) to authenticated, service_role;

-- ---- 4. set_booking_no_show: true = a no-show as the old switch made it; false = undo, back to an ordinary unmarked session (booking_put_back) --------
create or replace function public.set_booking_no_show(p_booking_id uuid, p_no_show boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
begin
  if p_no_show then
    -- The old screen's switch (until the app update): as before, a session paid at booking stays taken (Charge: nothing more) and an unpaid one is not charged (Waive).
    perform public.resolve_no_show(p_booking_id, coalesce((select b.credit_state = 'prepaid' from public.bookings b where b.id = p_booking_id), false));
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

  update public.bookings set no_show = false where id = p_booking_id;
  -- Only a no-show that changed what the session cost has anything to put back (Charge on an unpaid session, Waive): a 'prepaid' one is left as it is.
  if v_b.credit_state in ('settled', 'waived') then
    perform public.booking_put_back(p_booking_id, 'Undid no-show');
  end if;
end;
$$;
revoke all on function public.set_booking_no_show(uuid, boolean) from public, anon;
grant execute on function public.set_booking_no_show(uuid, boolean) to authenticated, service_role;

-- ---- 5. resolve_late_change: a charge is a session used, and only what the visit's one session still lacks ---------------------------------------------
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
  v_status text;
  v_take int;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select athlete_id, group_id, coach_id, late_charge_state, late_change_kind, credit_state, status
    into v_athlete_id, v_group_id, v_coach_id, v_state, v_kind, v_credit_state, v_status
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
    -- The visit's ONE session (Ron, Oct 19: a late move "should only be one session"): take only what this booking has not already taken (paid when it was booked, or settled
    -- when it happened: nothing more; given back when it was cancelled: one). Always recorded, a 0 entry when nothing more is taken, so a charged late move stays this visit's one
    -- session whatever is undone later. A second late move of a session already charged for one: nothing at all.
    if v_kind = 'reschedule' and public.booking_late_move_charged(p_booking_id) then
      null;
    else
      v_take := greatest(0, 1 - public.booking_taken(p_booking_id));
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, -v_take, 'delivered',
        case when v_kind = 'reschedule' then 'Late reschedule, charged by your coach' else 'Late cancellation, charged by your coach' end, p_booking_id, auth.uid());
      if v_take > 0 and v_status = 'confirmed' then
        update public.bookings set credit_state = 'settled' where id = p_booking_id;
      end if;
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
-- The live text (0291) with one block added after the "already started" check, a waiting late move cleared when the coach cancels, and refunds of only what was taken.
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
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to cancel this booking';
  end if;

  select athlete_id, group_id, coach_id, status, credit_state, start_at, end_at, attended_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_state, v_start_at, v_end_at, v_attended_at
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

  -- FIX 3 (0428): a late move the coach charged is this visit's one session. The client cancelling it afterwards (even after moving it again) gets nothing back and it is
  -- not flagged again. (A coach cancelling it gives the session back below, as any coach cancellation does.)
  if v_is_athlete_cancelling and not coalesce(public.is_group_coach(v_group_id), false)
     and public.booking_late_move_charged(p_booking_id) then
    -- A later late move still waiting for the coach is settled by this one: the earlier charge stands.
    update public.bookings set status = 'cancelled', late_charge_state = case when late_charge_state = 'flagged' then 'charged' else late_charge_state end where id = p_booking_id;
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
  -- FIX 3 (0428): the coach cancelling gives the session back, so a late move still waiting for Charge or Waive has nothing left to decide.
  if not v_is_athlete_cancelling then
    update public.bookings set late_charge_state = 'waived' where id = p_booking_id and late_charge_state = 'flagged';
  end if;

  if v_late then
    -- A client cancelling inside the window is FLAGGED for the coach, who decides whether it counts (Charge or Waive). Nothing is taken
    -- automatically: a credit already taken at booking is given back, and the coach can take it again with Charge.
    update public.bookings
      set late_cancel = true, late_change_kind = 'cancel', late_charge_state = 'flagged'
      where id = p_booking_id;
    if v_state in ('prepaid', 'settled') and least(1, public.booking_taken(p_booking_id)) > 0 then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, least(1, public.booking_taken(p_booking_id)), 'refund', 'Booking cancelled inside the window; your coach decides if it counts', p_booking_id, auth.uid());
    end if;
    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach_id, v_group_id, 'late_change',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A client') || ' cancelled a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  elsif v_state in ('prepaid', 'settled') then
    -- A credit was taken for this booking and the cancellation is in time (or made by the coach): it comes back. FIX 3 (0428): only what it actually took (a 'prepaid'
    -- booking that never took a session gives nothing back).
    if v_should_refund and least(1, public.booking_taken(p_booking_id)) > 0 then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, least(1, public.booking_taken(p_booking_id)), 'refund', 'Booking cancelled', p_booking_id, auth.uid());
    end if;
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$$;
revoke all on function public.cancel_booking_and_refund_credit(uuid) from public, anon;
grant execute on function public.cancel_booking_and_refund_credit(uuid) to authenticated, service_role;

-- ---- 7. undo_booking_attended: back to an ordinary unmarked session (booking_put_back) ------------------------------------------------------------
create or replace function public.undo_booking_attended(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
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
    -- FIX 3 (0428): back to what an unmarked visit costs, from its own history (booking_put_back): what attendance took comes back, never more, and a late-move
    -- charge stays (the booking stays settled by it), whatever else was marked and undone before.
    update public.bookings set attended_at = null where id = p_booking_id;
    perform public.booking_put_back(p_booking_id, 'Undid attended');
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
  -- Only right after a workout the coach logged here: never an imported one, one that already used a session the old way (the "Use 1 session credit" box), or an old one.
  if v_s.import_batch_id is not null or coalesce(v_s.is_historical, false) or coalesce(v_s.deduct_session_credit, false)
     or coalesce(v_s.completed_at, now()) < now() - interval '1 day' then
    raise exception 'this workout cannot be added as a walk-in';
  end if;

  -- Already on the calendar (linked, or a same-day session found now): that session, settled once; never a second one.
  v_id := coalesce(v_s.booking_id, public.match_booking_for_session(p_session_id));
  if v_id is not null then
    perform public.settle_booking_internal(v_id, 1, 'Workout logged', v_coach, v_s.athlete_id, v_s.group_id);
    return v_id;
  end if;

  v_tz := coalesce(public.coach_time_zone(v_coach), 'America/New_York');
  v_local := v_s.started_at at time zone v_tz;

  -- A class they joined or attended at that time, or a session that day already linked to another workout: this visit is already on the calendar.
  if exists (
    select 1 from public.group_session_attendees a
    join public.group_sessions gs on gs.id = a.group_session_id
    where a.athlete_id = v_s.athlete_id and a.status in ('joined', 'attended') and gs.status is distinct from 'cancelled'
      and gs.start_at < coalesce(v_s.completed_at, now()) and gs.end_at > v_s.started_at
  ) or exists (
    select 1 from public.bookings b
    join public.athlete_sessions o on o.booking_id = b.id and o.id <> p_session_id
    where b.athlete_id = v_s.athlete_id and b.group_id = v_s.group_id and b.status = 'confirmed'
      and (b.start_at at time zone coalesce(public.coach_time_zone(b.coach_id), 'America/New_York'))::date
          = (v_s.started_at at time zone coalesce(public.coach_time_zone(b.coach_id), 'America/New_York'))::date
  ) then
    raise exception 'this workout is already on the calendar (a class or a session that day), so it was not added and no session was used';
  end if;
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

-- ---- 10. guard_athlete_session_columns ----------------------------------------------------------------------------------------------------------------
-- The live text (0274) with two things added: the link match_booking_for_session makes (it alone sets app.fix3_match_link, around its own update) is kept when the client
-- finishes a workout the coach started, and on a workout a coach logged the client cannot move its start, mark it imported, or change when it finished.
create or replace function public.guard_athlete_session_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link boolean := old.booking_id is null and coalesce(current_setting('app.fix3_match_link', true), '') = '1';
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    perform public.audit_blocked('athlete_sessions', old.id::text, to_jsonb(old), to_jsonb(new),
      case when v_link
        then array['logged_by_coach', 'deduct_session_credit', 'is_historical', 'session_type_id', 'athlete_id', 'group_id', 'workout_id']
        else array['logged_by_coach', 'deduct_session_credit', 'booking_id', 'is_historical', 'session_type_id', 'athlete_id', 'group_id', 'workout_id'] end);
    new.logged_by_coach := old.logged_by_coach;
    new.deduct_session_credit := old.deduct_session_credit;
    if not v_link then
      new.booking_id := old.booking_id;
    end if;
    new.is_historical := old.is_historical;
    new.session_type_id := old.session_type_id;
    new.athlete_id := old.athlete_id;
    new.group_id := old.group_id;
    new.workout_id := old.workout_id;
    -- FIX 3 (0428): a workout the coach logged keeps its start, its import mark, and (once finished) its finish, so nothing can be made to miss its session on the calendar.
    if old.logged_by_coach then
      perform public.audit_blocked('athlete_sessions', old.id::text, to_jsonb(old), to_jsonb(new), array['import_batch_id', 'started_at']);
      new.import_batch_id := old.import_batch_id;
      new.started_at := old.started_at;
      if old.completed_at is not null then
        new.completed_at := old.completed_at;
      end if;
    end if;
    -- Reopening a completed session is refused and recorded (finishing a session is not a change from "completed", so it is never logged).
    if old.status = 'completed' and new.status is distinct from old.status then
      perform public.audit_blocked('athlete_sessions', old.id::text, to_jsonb(old), to_jsonb(new), array['status']);
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_athlete_session_columns() from public, anon, authenticated;

commit;
