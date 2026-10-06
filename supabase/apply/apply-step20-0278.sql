-- STEP 20: 0278 clients can book their own sessions (one at a time, weekly, or by joining a waiting list) only when the coach switches self-booking on (off by default)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: From now on a client cannot book their own session unless you switch on 'Let clients book their own sessions' on the Availability page (it is off for everyone). You can still schedule any client. Test: as a throwaway client try to book a session (it must say your coach schedules your sessions); as the coach schedule one for them (it must work).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'da934a4629a0f09580619b7c908ab42a' from pg_proc p where p.oid = to_regprocedure('public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)')), false) and coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'a14562f9889b8094e99a5403e5423835' from pg_proc p where p.oid = to_regprocedure('public.create_recurring_booking_series(uuid, uuid, uuid, timestamptz, integer, integer)')), false) and coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'f2d3243ac4fcf1876d894178e8a937f7' from pg_proc p where p.oid = to_regprocedure('public.join_booking_waitlist(uuid, uuid, uuid, timestamptz, timestamptz)')), false))) then
    raise exception 'Step 20 (0278) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0278_self_booking_switch.sql
-- ====================================================================================================

-- Ron's rule (Oct 6): clients cannot book their own sessions unless the coach switches that on. Per coach, OFF by default (every existing coach is
-- off, so Ron's clients cannot book themselves while he schedules them).
--
--  * coach_booking_policies.self_booking_enabled (boolean, default false). A coach's own policy row already is theirs to write.
--  * book_session: when the caller is the client booking for themselves and the coach has not switched self-booking on, it refuses with
--    'your coach schedules your sessions'. The 0248 text as live, with only that check added. A coach booking a client, and the server (service
--    role: the nightly weekly-schedule top-up and the like), are unaffected.
--  * create_recurring_booking_series and join_booking_waitlist carry the same check at the top: they are other ways for a client to book themselves, and
--    the weekly one would otherwise swallow the refusal and report every week as failed.
--  * A coach who is also their own client (a self-coach account) is refused until the switch is on, like any client.
--  * Moving an existing session (reschedule_booking) is NOT covered by this switch.
-- Needs 0248, 0218 and 0208 (coach_booking_policies). Re-running replaces the functions again.

alter table public.coach_booking_policies
  add column if not exists self_booking_enabled boolean not null default false;

-- ---- booking ----
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
  v_self_booking boolean;
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

  -- A client booking for themselves only works when this coach has switched self-booking on (off by default). Checked here, not just in the
  -- screens, so no old tab or direct call can get around it. A coach scheduling a client, and the server's own jobs, are not affected.
  if v_is_self and auth.role() is distinct from 'service_role' then
    select coalesce(bp.self_booking_enabled, false) into v_self_booking
    from public.coach_booking_policies bp where bp.coach_id = p_coach_id;
    if not coalesce(v_self_booking, false) then
      raise exception 'your coach schedules your sessions';
    end if;
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

-- ---- weekly schedules ----
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

  -- Self-booking is a per-coach switch (off by default); a client acting for themselves needs it on.
  if auth.uid() = p_athlete_id and auth.role() is distinct from 'service_role'
     and not coalesce((select bp.self_booking_enabled from public.coach_booking_policies bp where bp.coach_id = p_coach_id), false) then
    raise exception 'your coach schedules your sessions';
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

-- ---- waiting list ----
create or replace function public.join_booking_waitlist(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_slot_start_at timestamp with time zone, p_slot_end_at timestamp with time zone)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entry_id uuid;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to join this waitlist';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to join this waitlist';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  -- Self-booking is a per-coach switch (off by default); a client acting for themselves needs it on.
  if auth.uid() = p_athlete_id and auth.role() is distinct from 'service_role'
     and not coalesce((select bp.self_booking_enabled from public.coach_booking_policies bp where bp.coach_id = p_coach_id), false) then
    raise exception 'your coach schedules your sessions';
  end if;

  if not exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id and b.status = 'confirmed'
      and b.start_at = p_slot_start_at and b.end_at = p_slot_end_at
  ) then
    raise exception 'that slot is not currently booked';
  end if;

  insert into public.booking_waitlist_entries (coach_id, athlete_id, group_id, slot_start_at, slot_end_at)
  values (p_coach_id, p_athlete_id, p_group_id, p_slot_start_at, p_slot_end_at)
  on conflict (athlete_id, coach_id, slot_start_at) do update
    set status = 'waiting', offered_at = null, offer_expires_at = null, push_sent_at = null
    where booking_waitlist_entries.status in ('expired', 'cancelled')
  returning id into v_entry_id;

  if v_entry_id is null then
    select id into v_entry_id from public.booking_waitlist_entries
      where athlete_id = p_athlete_id and coach_id = p_coach_id and slot_start_at = p_slot_start_at;
  end if;

  return v_entry_id;
end;
$function$;

commit;
