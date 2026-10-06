-- UNDO for step 20 (0278). Only if booking a session breaks after step 20. Puts book_session, the weekly-schedule function and the waiting-list function back to the previous versions (clients can book themselves again) and removes the mode column and its two helper functions.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
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

drop function if exists public.assert_client_may_book_directly(uuid, uuid, uuid);
drop function if exists public.coach_booking_mode(uuid);
alter table public.coach_booking_policies drop column if exists booking_mode;
commit;
