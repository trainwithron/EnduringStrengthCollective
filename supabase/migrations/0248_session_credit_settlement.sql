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

  if auth.uid() = p_athlete_id and p_delta > 0 then
    raise exception 'not authorized to increase your own session credits directly';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
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
      where athlete_id = p_athlete_id and group_id = p_group_id;
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
  from public.bookings where id = p_booking_id;

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
create or replace function public.settle_booking_internal(p_booking_id uuid, p_cost int, p_note text, p_by uuid)
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
revoke all on function public.settle_booking_internal(uuid, int, text, uuid) from public, anon, authenticated;

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
  if v_b.attended_at is null then
    return false;
  end if;

  if v_b.credit_state = 'settled' then
    select coalesce(-sum(amount), 0) into v_taken
    from public.session_credit_ledger
    where booking_id = p_booking_id and kind = 'delivered';
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
-- complete_workout_session is large and unrelated to this change, so (as 0231 did) the live definition is read back and
-- one block is rewritten, failing loudly if the expected text is not found.
do $migrate$
declare
  v_def text;
  v_old text := $old$  if v_session.logged_by_coach and v_session.deduct_session_credit and v_credit_cost > 0 then
    update public.session_credits
      set balance = greatest(0, balance - v_credit_cost), updated_at = v_completed_at
      where session_credits.athlete_id = v_session.athlete_id and session_credits.group_id = v_session.group_id;
    if found then
      v_credit_consumed := true;
    end if;
  end if;$old$;
  v_new text := $new$  if v_session.logged_by_coach and v_session.booking_id is not null then
    -- The session is on the calendar and the coach logged it: settle that booking (once, never twice).
    v_credit_consumed := public.settle_booking_internal(v_session.booking_id, v_credit_cost, 'Workout logged', auth.uid());
  elsif v_session.logged_by_coach and v_session.deduct_session_credit and v_credit_cost > 0 then
    -- Not tied to a booking: follows the explicit choice made when the session was started.
    perform public.apply_session_credit_change(v_session.athlete_id, v_session.group_id, -v_credit_cost, 'delivered', 'Workout logged', null, auth.uid());
    v_credit_consumed := true;
  end if;$new$;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  where p.proname = 'complete_workout_session'
    and p.pronamespace = 'public'::regnamespace;

  if position(v_old in v_def) = 0 then
    raise exception 'complete_workout_session: credit block not found';
  end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$migrate$;

-- ---- recurring series: up to 52 weeks, no credit at booking, wall-clock time kept across daylight saving ----------
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
