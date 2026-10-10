-- Session credits settle when the session actually happens, and can go below zero.
--
-- Before this, a coach scheduling a client took a credit AT BOOKING (floored at zero, so it silently drained
-- whatever was left), a 52-week series was impossible (cap 12, one credit per occurrence), and a booked session
-- that was then logged in person could be charged a second time. The rules now:
--
--   * A booking the COACH makes takes nothing. It starts 'unsettled'. Scheduling never depends on balance.
--   * A booking the CLIENT makes still needs a credit and takes it at booking. It starts 'prepaid'.
--   * When the session happens it settles, exactly once:
--       - the coach logs the workout for that booking (athlete_sessions.booking_id), or
--       - the coach taps "Mark as attended".
--     An unsettled booking takes 1 credit (the session type's cost when logged) and becomes 'settled'. A prepaid
--     booking is just marked attended (already paid). Either way it can never be charged twice.
--   * "Waive" (hold, no charge) makes an unsettled booking 'waived'. "Undo attended" gives the credit back.
--   * The balance has no floor. Below zero reads as "owed N sessions" for the coach; nothing is blocked.
--   * A workout the client logs for themselves, not tied to a booking, deducts nothing. A coach-logged workout with
--     no booking still follows the explicit choice made when it was started (0231).
--
-- Every change goes through apply_session_credit_change (0246), so the ledger shows each one.
-- Requires 0246. Compatible with deployed code: function names and signatures are unchanged.

alter table public.bookings
  add column if not exists credit_state text not null default 'prepaid'
    check (credit_state in ('prepaid', 'unsettled', 'settled', 'waived')),
  add column if not exists attended_at timestamptz;
-- Every booking that already exists was charged at booking time under the old rules, so 'prepaid' (the default)
-- is the accurate state for all of them.

-- ---- manual adjustments: same signature, no floor, recorded -------------------------------------------------
create or replace function public.adjust_session_credits(p_athlete_id uuid, p_group_id uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'Not authorized to adjust these session credits';
  end if;

  -- A client never changes their own balance directly, up or down: bookings, cancellations and rescheduling go through
  -- their own functions. (With no floor, a client pushing their own balance negative would otherwise be possible.)
  if auth.uid() = p_athlete_id then
    raise exception 'not authorized to change your own session credits directly';
  end if;

  if auth.role() is distinct from 'service_role' and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to adjust these session credits';
  end if;

  return public.apply_session_credit_change(p_athlete_id, p_group_id, p_delta, 'adjusted', null, null, auth.uid());
end;
$function$;

-- Used by the Stripe webhook so a purchase shows in the ledger as a purchase. Service role only.
create or replace function public.grant_session_credits(
  p_athlete_id uuid,
  p_group_id uuid,
  p_delta int,
  p_kind text,
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;
  if p_kind not in ('purchased', 'assigned', 'adjusted') or p_delta < 1 then
    raise exception 'invalid grant';
  end if;
  return public.apply_session_credit_change(p_athlete_id, p_group_id, p_delta, p_kind, p_note, null, null);
end;
$$;
revoke all on function public.grant_session_credits(uuid, uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.grant_session_credits(uuid, uuid, int, text, text) to service_role;

-- ---- booking: the coach's bookings take nothing ----------------------------------------------------------------
create or replace function public.book_session(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_self boolean;
  v_balance int;
  v_booking_id uuid;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to book this session';
  end if;

  v_is_self := coalesce(auth.uid() = p_athlete_id, false);

  if not v_is_self and not public.is_group_coach(p_group_id) and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized to book this session';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid time range';
  end if;

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = p_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if v_is_self and (p_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;

  -- Only a client booking for themselves needs a credit. A coach can always schedule.
  if v_is_self then
    select balance into v_balance from public.session_credits
      where athlete_id = p_athlete_id and group_id = p_group_id
      for update;
    if coalesce(v_balance, 0) <= 0 then
      raise exception 'no session credits remaining';
    end if;
  end if;

  if exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id
      and b.status = 'confirmed'
      and b.start_at < (p_end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (p_start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = p_coach_id
      and d.status = 'confirmed'
      and d.start_at < (p_end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (p_start_at - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;

  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state)
  values (p_coach_id, p_athlete_id, p_group_id, p_start_at, p_end_at, 'confirmed',
          case when v_is_self then 'prepaid' else 'unsettled' end)
  returning id into v_booking_id;

  if v_is_self then
    perform public.apply_session_credit_change(p_athlete_id, p_group_id, -1, 'booked', 'Booked a session', v_booking_id, auth.uid());
  end if;

  update public.booking_waitlist_entries
    set status = case when athlete_id = p_athlete_id then 'claimed' else 'expired' end
    where coach_id = p_coach_id
      and slot_start_at = p_start_at
      and slot_end_at = p_end_at
      and status in ('waiting', 'offered');

  return v_booking_id;
end;
$function$;

-- ---- cancelling: only give back what was actually taken ---------------------------------------------------------
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
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to cancel this booking';
  end if;

  select athlete_id, group_id, coach_id, status, credit_state, start_at, end_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_state, v_start_at, v_end_at
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

  if v_is_athlete_cancelling then
    select coalesce(
      (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
      24
    ) into v_window_hours;
    v_should_refund := (v_start_at - now()) >= make_interval(hours => v_window_hours);
  else
    v_should_refund := true;
  end if;

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  if v_state in ('prepaid', 'settled') then
    -- A credit was taken for this booking: it comes back unless the client cancelled inside the window.
    if v_should_refund then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, 1, 'refund', 'Booking cancelled', p_booking_id, auth.uid());
    end if;
  elsif v_state = 'unsettled' and v_is_athlete_cancelling and not v_should_refund then
    -- Nothing was taken at booking, so a late cancellation by the client is where the session is charged.
    update public.bookings set late_cancel = true where id = p_booking_id;
    perform public.apply_session_credit_change(v_athlete_id, v_group_id, -1, 'adjusted', 'Late cancellation', p_booking_id, auth.uid());
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

-- ---- settling at delivery ------------------------------------------------------------------------------------------
-- Internal: settle one booking exactly once. Returns true when a credit was taken.
drop function if exists public.settle_booking_internal(uuid, int, text, uuid);

create or replace function public.settle_booking_internal(
  p_booking_id uuid,
  p_cost int,
  p_note text,
  p_by uuid,
  p_expected_athlete uuid default null,
  p_expected_group uuid default null
)
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

  update public.bookings set attended_at = now() where id = p_booking_id;

  if v_b.credit_state = 'unsettled' and coalesce(p_cost, 1) > 0 then
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, -coalesce(p_cost, 1), 'delivered', p_note, p_booking_id, p_by);
    update public.bookings set credit_state = 'settled' where id = p_booking_id;
    return true;
  end if;
  return false; -- prepaid or waived: attended, nothing more to take
end;
$$;
revoke all on function public.settle_booking_internal(uuid, int, text, uuid, uuid, uuid) from public, anon, authenticated;

-- One-tap "Mark as attended" for a coach. Returns true when a credit was taken.
create or replace function public.mark_booking_attended(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
begin
  select group_id into v_group from public.bookings where id = p_booking_id;
  if v_group is null then
    raise exception 'booking not found';
  end if;
  if auth.role() is distinct from 'service_role' and (auth.uid() is null or not public.is_group_coach(v_group)) then
    raise exception 'not authorized to mark this session attended';
  end if;
  return public.settle_booking_internal(p_booking_id, 1, 'Marked as attended', auth.uid());
end;
$$;
grant execute on function public.mark_booking_attended(uuid) to authenticated;

-- Undo: give back what attendance took and reopen the booking.
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
grant execute on function public.undo_booking_attended(uuid) to authenticated;

-- Waive: the coach decides this session is not charged. Only an unsettled booking can be waived.
create or replace function public.waive_booking(p_booking_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
  v_balance int;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if auth.role() is distinct from 'service_role' and (auth.uid() is null or not public.is_group_coach(v_b.group_id)) then
    raise exception 'not authorized to change this session';
  end if;
  if v_b.credit_state <> 'unsettled' then
    raise exception 'only a session that has not been charged can be waived (undo attended first)';
  end if;

  update public.bookings set credit_state = 'waived' where id = p_booking_id;
  select balance into v_balance from public.session_credits where athlete_id = v_b.athlete_id and group_id = v_b.group_id;
  insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note, booking_id, created_by)
  values (v_b.athlete_id, v_b.group_id, 'waived', 0, coalesce(v_balance, 0), nullif(trim(coalesce(p_note, '')), ''), p_booking_id, auth.uid());
  return true;
end;
$$;
grant execute on function public.waive_booking(uuid, text) to authenticated;

-- ---- logging a workout settles the booking it belongs to -------------------------------------------------------
-- SUPERSEDED (note added 2026-10-10, comment only): production runs the version in 0236_workout_session_integrity.sql, which is applied AFTER this one and adds the row lock and
-- the safe repeat (a second call returns the existing log). The 0236 text plus the credit block below is what is live. Release AA (0329) replaced the live function from the 0236 text.
-- The whole function is replaced (no text matching against whatever is there): this is the live definition of complete_workout_session as
-- read on 2026-10-05 (md5 49fe3d6b3ec9ecb92f44b1087574dfb0 of pg_get_functiondef), with ONE block changed: the credit block at the end, which now
-- settles the booking the coach logged (or follows the explicit choice made when the session was started). Everything else is unchanged.
-- apply-0248-precheck.sql confirms the live function is still that exact version before this runs.
create or replace function public.complete_workout_session(p_session_id uuid)
 RETURNS TABLE(workout_log_id uuid, athlete_id uuid, group_id uuid, total_volume numeric, total_sets_completed integer, new_prs text[], new_records text[], credit_consumed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session record;
  v_completed_at timestamptz := now();
  v_duration int;
  v_total_volume numeric;
  v_total_sets int;
  v_new_prs text[];
  v_new_records text[];
  v_log_id uuid;
  v_credit_consumed boolean := false;
  v_credit_cost int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to complete this session';
  end if;

  select * into v_session from public.athlete_sessions where id = p_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  if auth.uid() <> v_session.athlete_id and not public.is_group_coach(v_session.group_id) then
    raise exception 'not authorized to complete this session';
  end if;

  v_duration := extract(epoch from (v_completed_at - v_session.started_at))::int;

  update public.athlete_sessions
    set status = 'completed', completed_at = v_completed_at, duration_seconds = v_duration
    where id = p_session_id;

  select coalesce(sum(sl.weight * sl.reps), 0), count(*)
    into v_total_volume, v_total_sets
  from public.set_logs sl
  join public.session_exercises se on se.id = sl.session_exercise_id
  where se.session_id = p_session_id and sl.status = 'completed';

  with combined_best as (
    select se.exercise_name as name,
      max(sl.weight) as best_weight,
      max(sl.distance) as best_distance,
      min(sl.time_seconds) as best_time,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end) as best_pace_seconds
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
    group by se.exercise_name
  ),
  prior_best as (
    select se.exercise_name as name,
      max(sl.weight) as best_weight,
      max(sl.distance) as best_distance,
      min(sl.time_seconds) as best_time,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end) as best_pace_seconds
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions asx on asx.id = se.session_id
    where asx.athlete_id = v_session.athlete_id
      and se.session_id <> p_session_id
      and sl.status = 'completed'
    group by se.exercise_name
  )
  select coalesce(array_agg(distinct cb.name), '{}')
    into v_new_prs
  from combined_best cb
  join prior_best pb on pb.name = cb.name
  where (cb.best_weight is not null and pb.best_weight is not null and cb.best_weight > pb.best_weight)
     or (cb.best_distance is not null and pb.best_distance is not null and cb.best_distance > pb.best_distance)
     or (cb.best_time is not null and pb.best_time is not null and cb.best_time < pb.best_time)
     or (cb.best_pace_seconds is not null and pb.best_pace_seconds is not null and cb.best_pace_seconds < pb.best_pace_seconds);

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  select coalesce(array_agg(distinct b.name), '{}') into v_new_records from broken b;

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  update public.exercise_records er
    set superseded_at = v_completed_at
    from broken b
    where er.group_id = v_session.group_id and er.superseded_at is null
      and er.exercise_name = b.name and er.tracked_field = b.tracked_field;

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, set_log_id, achieved_at)
  select v_session.group_id, b.name, b.tracked_field, b.direction, b.best, v_session.athlete_id, b.best_set_log_id, v_completed_at
  from broken b;

  insert into public.workout_logs (
    session_id, athlete_id, group_id, workout_id,
    total_duration_seconds, total_volume, total_sets_completed, new_prs, logged_by_coach
  ) values (
    p_session_id, v_session.athlete_id, v_session.group_id, v_session.workout_id,
    v_duration, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), v_session.logged_by_coach
  )
  returning id into v_log_id;

  v_credit_cost := 1;
  if v_session.session_type_id is not null then
    select credit_cost into v_credit_cost from public.session_types where id = v_session.session_type_id;
    if v_credit_cost is null then
      v_credit_cost := 1;
    end if;
  end if;

  if v_session.logged_by_coach and v_session.booking_id is not null then
    -- The session is on the calendar and the coach logged it: settle that booking (once, never twice).
    v_credit_consumed := public.settle_booking_internal(v_session.booking_id, v_credit_cost, 'Workout logged', auth.uid(), v_session.athlete_id, v_session.group_id);
  elsif v_session.logged_by_coach and v_session.deduct_session_credit and v_credit_cost > 0 then
    -- Not tied to a booking: follows the explicit choice made when the session was started.
    perform public.apply_session_credit_change(v_session.athlete_id, v_session.group_id, -v_credit_cost, 'delivered', 'Workout logged', null, auth.uid());
    v_credit_consumed := true;
  end if;

  return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), coalesce(v_new_records, '{}'), v_credit_consumed;
end;
$function$;

-- ---- recurring series: up to 52 weeks, no credit at booking, wall-clock time kept across daylight saving ----------
-- The series table itself capped the count at 12 (0210), so the function below would have failed on the 13th week.
alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_occurrences_total_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_occurrences_total_check check (occurrences_total > 0 and occurrences_total <= 52);

create or replace function public.create_recurring_booking_series(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_first_start_at timestamp with time zone, p_duration_minutes integer, p_occurrences_total integer)
returns table(series_id uuid, booked_count integer, failed_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_series_id uuid;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_new_booking_id uuid;
  v_booked int := 0;
  v_failed int := 0;
  v_tz text;
  i int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to create this booking series';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to create this booking series';
  end if;
  if p_occurrences_total <= 0 or p_occurrences_total > 52 then
    raise exception 'occurrences_total must be between 1 and 52';
  end if;

  -- The coach's own time zone, so "8:00 every Tuesday" stays 8:00 when the clocks change.
  select coalesce(pr.timezone, 'UTC') into v_tz from public.profiles pr where pr.id = p_coach_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;

  insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes, occurrences_total)
  values (p_coach_id, p_athlete_id, p_group_id, extract(dow from p_first_start_at at time zone v_tz)::smallint, (p_first_start_at at time zone v_tz)::time, p_duration_minutes, p_occurrences_total)
  returning id into v_series_id;

  for i in 0..(p_occurrences_total - 1) loop
    v_start_at := ((p_first_start_at at time zone v_tz) + (i * interval '7 days')) at time zone v_tz;
    v_end_at := v_start_at + make_interval(mins => p_duration_minutes);
    begin
      v_new_booking_id := public.book_session(p_coach_id, p_athlete_id, p_group_id, v_start_at, v_end_at);
      update public.bookings set recurring_series_id = v_series_id where id = v_new_booking_id;
      v_booked := v_booked + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return query select v_series_id, v_booked, v_failed;
end;
$function$;

-- ---- rescheduling: the late fee goes through the internal function ---------------------------------------------------
-- The client reschedules their own booking, and a late change takes one more session. That used to call
-- adjust_session_credits as the client, which clients can no longer do; same function otherwise, as live.
create or replace function public.reschedule_booking(p_booking_id uuid, p_new_start_at timestamp with time zone, p_new_end_at timestamp with time zone)
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
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_window_hours int;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'Not authorized to reschedule this booking';
  end if;

  select athlete_id, group_id, coach_id, status, start_at, end_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at, v_end_at
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id then
    raise exception 'not authorized to reschedule this booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a reschedulable state';
  end if;

  if p_new_end_at <= p_new_start_at then
    raise exception 'invalid time range';
  end if;

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = v_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if (p_new_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.coach_id = v_coach_id
      and b.id <> p_booking_id
      and b.status = 'confirmed'
      and b.start_at < (p_new_end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (p_new_start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = v_coach_id
      and d.status = 'confirmed'
      and d.start_at < (p_new_end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (p_new_start_at - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;

  select coalesce(
    (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
    24
  ) into v_window_hours;

  update public.bookings
    set start_at = p_new_start_at, end_at = p_new_end_at, reminder_sent_at = null
    where id = p_booking_id;

  if (v_start_at - now()) < make_interval(hours => v_window_hours) then
    perform public.apply_session_credit_change(v_athlete_id, v_group_id, -1, 'adjusted', 'Late reschedule', p_booking_id, auth.uid());
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;
