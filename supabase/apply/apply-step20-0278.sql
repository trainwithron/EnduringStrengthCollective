-- STEP 20: 0278 each coach picks how clients book: on their own, request and the coach confirms, or the coach schedules everyone (existing coaches start as 'coach schedules')
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Every coach is set to 'I schedule everyone' until they choose: clients cannot book, start a weekly schedule or join a waiting list on their own. Open Availability and pick the mode (Ron: 'Clients request, I confirm' once step 21 is also applied; 'Clients book on their own' restores today's behaviour). You can always schedule any client. Test as a throwaway client: try to book (it must refuse); switch the mode to 'book on their own' and try again.
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
-- migration 0278_booking_mode.sql
-- ====================================================================================================

-- Ron's rule (Oct 6): each coach picks how clients book, three ways:
--   'free'            Clients book on their own (how it worked before).
--   'request'         Clients request a time and the coach confirms (step 21 adds the requests). Nothing is booked or held until the coach says yes.
--   'coach_schedules' The coach schedules everyone; a client cannot book, and asks by message.
-- Existing coaches start as 'coach_schedules' (the safest). A coach changes it on the Availability page; Ron sets his to 'request'.
--
--  * coach_booking_policies.booking_mode (default 'coach_schedules').
--  * coach_time_zone(coach): the coach's profile zone, or null when none is set. create_recurring_booking_series uses it (America/New_York when null,
--    the app default) instead of its old UTC fallback, so a coach with no zone no longer gets weekly sessions on UTC time.
--  * coach_booking_mode(coach): the mode, 'coach_schedules' when the coach has no policy row.
--  * assert_client_may_book_directly(coach, athlete, group): refuses a client booking directly unless the mode is 'free'. A coach acting for
--    a client, a coach booking themselves (a self-coach account) and the server's own routines are never refused.
--  * book_session, create_recurring_booking_series and join_booking_waitlist call it first. Each is the live text with only that call added
--    (the paste step checks the live text first). A weekly schedule or a waiting-list join is also a way to book, so they follow the same rule.
--  * Moving an existing session is handled in step 21 (reschedule_booking).
-- The helper functions are internal: signed-in users cannot execute them, only the booking functions (which run as their owner) call them.
-- Needs 0248, 0218 and 0208 (coach_booking_policies). Re-running replaces the functions again.

alter table public.coach_booking_policies
  add column if not exists booking_mode text not null default 'coach_schedules'
    check (booking_mode in ('free', 'request', 'coach_schedules'));

-- The coach's own time zone from their profile, or null when none is set (or it is not a real zone). One place, so every booking function agrees;
-- the screens' default for a coach with none is America/New_York (lib/timezone.ts).
create or replace function public.coach_time_zone(p_coach_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select pr.timezone from public.profiles pr
  where pr.id = p_coach_id and pr.timezone is not null and exists (select 1 from pg_timezone_names n where n.name = pr.timezone);
$function$;

revoke all on function public.coach_time_zone(uuid) from public, anon, authenticated;
grant execute on function public.coach_time_zone(uuid) to service_role;

create or replace function public.coach_booking_mode(p_coach_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select bp.booking_mode from public.coach_booking_policies bp where bp.coach_id = p_coach_id), 'coach_schedules');
$function$;

-- Internal: only the booking functions (which run as their owner) call it, so signed-in users cannot ask it about another coach.
revoke all on function public.coach_booking_mode(uuid) from public, anon, authenticated;
grant execute on function public.coach_booking_mode(uuid) to service_role;

-- Raises when a client acting for themselves may not book directly under this coach's booking mode. A coach acting for a client, a coach
-- booking themselves as their own client (a self-coach account), and the server's own routines are never refused.
create or replace function public.assert_client_may_book_directly(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_mode text;
begin
  if auth.role() = 'service_role' or auth.uid() is distinct from p_athlete_id then
    return;
  end if;
  if coalesce(public.is_group_coach(p_group_id), false) then
    return;
  end if;
  v_mode := public.coach_booking_mode(p_coach_id);
  if v_mode = 'request' then
    raise exception 'your coach confirms new sessions: send a request instead';
  elsif v_mode <> 'free' then
    raise exception 'your coach schedules your sessions';
  end if;
end;
$function$;

revoke all on function public.assert_client_may_book_directly(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assert_client_may_book_directly(uuid, uuid, uuid) to service_role;

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

  -- The coach's booking mode decides whether a client may book directly (see assert_client_may_book_directly).
  perform public.assert_client_may_book_directly(p_coach_id, p_athlete_id, p_group_id);

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
  perform public.assert_client_may_book_directly(p_coach_id, p_athlete_id, p_group_id);
  if p_occurrences_total <= 0 or p_occurrences_total > 52 then
    raise exception 'occurrences_total must be between 1 and 52';
  end if;

  -- The coach's own time zone, so "8:00 every Tuesday" stays 8:00 when the clocks change.
  v_tz := coalesce(public.coach_time_zone(p_coach_id), 'America/New_York');

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
  perform public.assert_client_may_book_directly(p_coach_id, p_athlete_id, p_group_id);

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
