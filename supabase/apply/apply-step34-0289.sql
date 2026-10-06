-- STEP 34: 0289 a window of hours can be tagged with one of your session types (Online, In person, Weight room, Practice, Game...), and a booking made inside it is tagged the same
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once and no existing window changes (no tag means any type). After the code deploy: on Availability each window has an optional 'Session type', sessions booked inside a tagged window carry that type (shown on the calendar day), and Business > Session types offers one-tap Online / In person or Weight room / Practice / Game. The type never changes what a session costs. Run after step 33.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_type_id'))) then
    raise exception 'Step 34 (0289) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0289_window_session_type.sql
-- ====================================================================================================

-- Tag a window of hours with a session type (Ron, Oct 6): "Online" hours and "In person" hours for a personal trainer; "Weight room", "Practice" and "Game" for
-- a team coach, or any names the coach makes. It reuses the session types that already exist (session_types: Business > Session types, the public booking page),
-- no second mechanism.
--
--  * coach_availability_windows.session_type_id: which type this window of hours is for. Null means "any type", which is how every window behaves today, so
--    nothing changes until a coach sets one. Deleting a type clears it on the windows (it never deletes a window).
--  * A booking made inside a tagged window is tagged with the same type, automatically, by a trigger on insert, so it holds for every way a booking is made (the
--    coach, a client, a confirmed request, a weekly schedule). A booking that already has a type (the public booking page sets one) keeps it, and a coach can
--    change the type of any booking afterwards. bookings.session_type_id already exists (0261); bookings.session_type (in person / video) is the separate
--    video-call switch and is not touched. The type does not change what a session costs: credits are untouched.
--  * The hours are the coach's local wall clock, so the trigger reads the booking on the coach's own clock (America/New_York until they set one, as everywhere).
--  * A window can only carry one of the coach's OWN session types: a trigger refuses a type that belongs to another coach (the foreign key alone only checks that
--    the type exists), so a coach who learns another coach's type id cannot attach it to their hours (Assistant's review).
-- Needs coach_availability_windows (0023), session_types (0180), bookings.session_type_id (0261), coach_time_zone (0278). Re-runnable.

alter table public.coach_availability_windows
  add column if not exists session_type_id uuid references public.session_types(id) on delete set null;

create index if not exists coach_availability_windows_session_type_id_idx on public.coach_availability_windows (session_type_id);

create or replace function public.guard_window_session_type()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.session_type_id is not null
     and not exists (select 1 from public.session_types st where st.id = new.session_type_id and st.coach_id = new.coach_id) then
    raise exception 'that session type is not yours';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_window_session_type() from public, anon, authenticated;

drop trigger if exists coach_availability_windows_guard_type on public.coach_availability_windows;
create trigger coach_availability_windows_guard_type
  before insert or update of session_type_id on public.coach_availability_windows
  for each row execute function public.guard_window_session_type();

create or replace function public.tag_booking_session_type()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tz text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_type uuid;
begin
  if new.session_type_id is not null then
    return new;
  end if;
  v_tz := coalesce(public.coach_time_zone(new.coach_id), 'America/New_York');
  v_local_start := new.start_at at time zone v_tz;
  v_local_end := new.end_at at time zone v_tz;
  -- The window that holds the whole session, on that weekday, if it has a type.
  select w.session_type_id into v_type
  from public.coach_availability_windows w
  where w.coach_id = new.coach_id
    and w.session_type_id is not null
    and w.weekday = extract(dow from v_local_start)::int
    and w.start_time <= v_local_start::time
    and w.end_time >= v_local_end::time
  order by w.start_time
  limit 1;
  new.session_type_id := v_type;
  return new;
end;
$function$;

-- Only ever runs as a trigger.
revoke all on function public.tag_booking_session_type() from public, anon, authenticated;

drop trigger if exists bookings_tag_session_type on public.bookings;
create trigger bookings_tag_session_type
  before insert on public.bookings
  for each row execute function public.tag_booking_session_type();

commit;
