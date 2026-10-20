-- UNDO for step 180 (0428). Only if step 180 misbehaves, and only while the FIX 3 item 4 app update is NOT live (it calls resolve_no_show and create_walk_in_booking). Puts the five functions back exactly as they were and drops the four new ones. Sessions already charged or given back stay as they are in the history.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $$
declare
  v_def text;
  v_from text := 'if v_session.logged_by_coach then' || chr(10) || '    -- FIX 3 (0428)';
  v_to text := 'return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets';
  v_start int;
  v_end int;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = 'public.complete_workout_session(uuid)'::regprocedure;
  v_def := replace(v_def, chr(13), '');
  v_start := position(v_from in v_def);
  v_end := position(v_to in v_def);
  if v_start = 0 or v_end <= v_start then
    raise exception 'complete_workout_session: the 0428 block was not found; nothing was changed';
  end if;
  v_def := substr(v_def, 1, v_start - 1)
    || 'if v_session.logged_by_coach and v_session.booking_id is not null then' || chr(10)
    || '    -- The session is on the calendar and the coach logged it: settle that booking (once, never twice).' || chr(10)
    || '    v_credit_consumed := public.settle_booking_internal(v_session.booking_id, v_credit_cost, ''Workout logged'', auth.uid(), v_session.athlete_id, v_session.group_id);' || chr(10)
    || '  elsif v_session.logged_by_coach and v_session.deduct_session_credit and v_credit_cost > 0 then' || chr(10)
    || '    -- Not tied to a booking: follows the explicit choice made when the session was started.' || chr(10)
    || '    perform public.apply_session_credit_change(v_session.athlete_id, v_session.group_id, -v_credit_cost, ''delivered'', ''Workout logged'', null, auth.uid());' || chr(10)
    || '    v_credit_consumed := true;' || chr(10)
    || '  end if;' || chr(10)
    || chr(10)
    || '  '
    || substr(v_def, v_end);
  execute v_def;
end $$;
create or replace function public.set_booking_no_show(p_booking_id uuid, p_no_show boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
  v_status text;
  v_start_at timestamptz;
begin
  select group_id, status, start_at into v_group_id, v_status, v_start_at
  from public.bookings where id = p_booking_id;

  if v_group_id is null then
    raise exception 'booking not found';
  end if;
  if not public.is_group_coach(v_group_id) then
    raise exception 'not authorized to mark attendance for this booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'only a confirmed booking can be marked';
  end if;
  if v_start_at > now() then
    raise exception 'cannot mark attendance for a future booking';
  end if;

  update public.bookings set no_show = p_no_show where id = p_booking_id;
end;
$$;
create or replace function public.resolve_late_change(p_booking_id uuid, p_charge boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_state text;
  v_kind text;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select athlete_id, group_id, coach_id, late_charge_state, late_change_kind
    into v_athlete_id, v_group_id, v_coach_id, v_state, v_kind
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
    perform public.apply_session_credit_change(
      v_athlete_id, v_group_id, -1, 'adjusted',
      case when v_kind = 'reschedule' then 'Late reschedule, charged by your coach' else 'Late cancellation, charged by your coach' end,
      p_booking_id, auth.uid()
    );
    update public.bookings set late_charge_state = 'charged' where id = p_booking_id;
  else
    update public.bookings set late_charge_state = 'waived' where id = p_booking_id;
  end if;
end;
$function$;
create or replace function public.cancel_booking_and_refund_credit(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;
create or replace function public.undo_booking_attended(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
  v_taken int;
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
    select coalesce(-sum(amount), 0) into v_taken
    from public.session_credit_ledger
    where booking_id = p_booking_id and kind in ('delivered', 'refund');
    if v_taken > 0 then
      perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, v_taken, 'refund', 'Undid attended', p_booking_id, auth.uid());
    end if;
    update public.bookings set credit_state = 'unsettled', attended_at = null where id = p_booking_id;
  else
    update public.bookings set attended_at = null where id = p_booking_id;
  end if;
  return true;
end;
$$;
drop function if exists public.create_walk_in_booking(uuid);
drop function if exists public.resolve_no_show(uuid, boolean);
drop function if exists public.match_booking_for_session(uuid);
drop function if exists public.booking_late_charge_taken(uuid);
commit;
