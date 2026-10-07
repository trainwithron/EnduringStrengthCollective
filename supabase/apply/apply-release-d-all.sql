-- RELEASE D: ONE paste. Steps 32, 33, 34 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 32: Nothing visible changes at once and no existing hours change. After the code deploy a coach can set Slot every 15 (or 5, 10, 20, 30) minutes together with a session length of 55 or 60: starts overlap, and booking one blocks the others it overlaps. Run this after step 25.
-- AFTER STEP 33: Nothing visible changes. A booking, a confirmed request, a weekly schedule or the public discovery form that would overlap another session (with your gap) is refused with the usual 'that slot was just taken', even if two arrive at the same moment. History is never re-checked. Run this after step 32.
-- AFTER STEP 34: Nothing visible changes at once and no existing window changes (no tag means any type). After the code deploy: on Availability each window has an optional 'Session type', sessions booked inside a tagged window carry that type (shown on the calendar day), and Business > Session types offers one-tap Online / In person or Weight room / Practice / Game. The type never changes what a session costs. Run after step 33.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release D, step 32: 0287 a session can be longer than the time between slot starts (a start every 15 minutes with a 55-minute session); the session still has to fit inside its window
do $g32$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('coach_availability_windows has the session length column (step 25 / 0283 is applied)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_minutes')),
      ('0287 is not already applied (the old rule, a session no longer than the step, is still the rule)', exists (select 1 from pg_constraint where conname = 'coach_availability_windows_session_minutes_range' and pg_get_constraintdef(oid) like '%slot_duration_minutes%')),
      ('no window already has hours where the end is not after the start', not exists (select 1 from public.coach_availability_windows where end_time <= start_time))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release D, step 32 (0287) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g32$;

-- ====================================================================================================
-- migration 0287_session_longer_than_step.sql
-- ====================================================================================================

-- A session can be longer than the time between slot starts (Ron, Oct 6: "start every 15 minutes, with a 55-minute session"; "we can be human with one another,
-- we don't have to be tied to a system"). 0283 added coach_availability_windows.session_minutes (how long a booked session lasts) next to slot_duration_minutes
-- (how often a slot starts) but also required the session never to be longer than the step, so a coach could not offer a start every 15 minutes for a 55-minute
-- session. Starts that overlap are fine: booking one blocks the others it overlaps (the booking functions already check overlap and the buffer on the real end
-- times), and the app now marks those slots as taken.
--
--  * The session length is still 5 to 480 minutes. It can no longer exceed the step's own bound, but it must fit inside the window it belongs to (a 90-minute
--    session in a one-hour window could never be booked).
--  * Nothing else changes: existing windows, their steps and their session lengths are untouched (every existing row already satisfies the looser rule).
-- Needs 0283. Re-runnable.

alter table public.coach_availability_windows
  drop constraint if exists coach_availability_windows_session_minutes_range;
alter table public.coach_availability_windows
  add constraint coach_availability_windows_session_minutes_range
  check (
    session_minutes is null
    or (session_minutes between 5 and 480 and session_minutes <= extract(epoch from (end_time - start_time)) / 60)
  );

-- ===== Release D, step 33: 0288 two bookings that overlap at different minutes can no longer both be saved at the same instant (a lock per coach, then a second overlap check before a confirmed future booking is saved or moved)
do $g33$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('bookings and discovery_bookings exist', to_regclass('public.bookings') is not null and to_regclass('public.discovery_bookings') is not null),
      ('0288 is not already applied (the overlap guard is not there yet)', not exists (select 1 from pg_trigger where tgname = 'bookings_guard_overlap'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release D, step 33 (0288) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g33$;

-- ====================================================================================================
-- migration 0288_booking_overlap_lock.sql
-- ====================================================================================================

-- Two bookings that overlap but start at different minutes can no longer both be saved at the same instant (Assistant's review of 0287, Oct 6).
--
-- Until now the only database guard against a double booking was the unique index on (coach_id, start_at): it catches two bookings at the same start, which
-- was enough while every session started on a slot. Now that a session can start at any minute and slots can overlap (a start every 15 minutes with a 55-minute
-- session), two bookings at 10:00 and 10:15 have different starts, and book_session, reschedule_booking, resolve_booking_request and book_discovery_call all
-- check for an overlap and then insert: two requests arriving together can both pass the check before either has saved.
--
-- The fix is one trigger on bookings and one on discovery_bookings. Before a confirmed future booking is saved (or moved), the trigger takes a lock that is
-- per coach (so one coach's bookings are saved one at a time and nobody else waits), and then looks again for an overlap, with the coach's gap (buffer) on
-- both sides, exactly as the booking functions do. The second of two simultaneous bookings waits for the first to commit and then sees it, and is refused with
-- the same message the functions use ("that slot was just taken"). The functions themselves are not changed: this is a safety net under every way a booking
-- is written (a client, the coach, a weekly schedule, a confirmed request, the public discovery form).
--
--  * Only a booking that is confirmed and has not ended yet is checked, so history is never touched or re-checked (a past session can be recorded, marked
--    attended or edited as before), and cancelling a booking is never refused.
--  * An update is checked only when the booking's start, end or status changes (moving it, or confirming it), not for other edits.
--  * The function runs with the owner's rights because it must see other clients' bookings; nobody signed in can call it directly.
-- Needs bookings (0023), discovery_bookings (0089) and coach_booking_policies (0068/0208). Re-runnable.

create or replace function public.guard_booking_overlap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_buffer_minutes int;
begin
  if new.status is distinct from 'confirmed' or new.end_at <= now() then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.start_at is not distinct from old.start_at
     and new.end_at is not distinct from old.end_at
     and old.status is not distinct from new.status then
    return new;
  end if;

  -- One lock per coach, held until this transaction ends, taken before the check so a second booking waits and then sees the first.
  perform pg_advisory_xact_lock(hashtextextended('booking:' || new.coach_id::text, 0));

  select coalesce(bp.buffer_minutes, 0) into v_buffer_minutes from public.coach_booking_policies bp where bp.coach_id = new.coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);

  if exists (
    select 1 from public.bookings b
    where b.coach_id = new.coach_id
      and b.status = 'confirmed'
      and (tg_table_name <> 'bookings' or b.id is distinct from new.id)
      and b.start_at < (new.end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (new.start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = new.coach_id
      and d.status = 'confirmed'
      and (tg_table_name <> 'discovery_bookings' or d.id is distinct from new.id)
      and d.start_at < (new.end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (new.start_at - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;
  return new;
end;
$function$;

-- Not callable by anyone signed in or signed out: it only ever runs as a trigger.
revoke all on function public.guard_booking_overlap() from public, anon, authenticated;

drop trigger if exists bookings_guard_overlap on public.bookings;
create trigger bookings_guard_overlap
  before insert or update of start_at, end_at, status on public.bookings
  for each row execute function public.guard_booking_overlap();

drop trigger if exists discovery_bookings_guard_overlap on public.discovery_bookings;
create trigger discovery_bookings_guard_overlap
  before insert or update of start_at, end_at, status on public.discovery_bookings
  for each row execute function public.guard_booking_overlap();

-- ===== Release D, step 34: 0289 a window of hours can be tagged with one of your session types (Online, In person, Weight room, Practice, Game...), and a booking made inside it is tagged the same
do $g34$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('coach_availability_windows and session_types exist', to_regclass('public.coach_availability_windows') is not null and to_regclass('public.session_types') is not null),
      ('bookings has the session type column (0261 is applied)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'session_type_id')),
      ('0289 is not already applied (the window tag column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_type_id'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release D, step 34 (0289) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g34$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 32 (0287)' as step, '0287 a session can be longer than the time between slot starts' as what, not ((exists (select 1 from pg_constraint where conname = 'coach_availability_windows_session_minutes_range' and pg_get_constraintdef(oid) like '%slot_duration_minutes%'))) as in_place
  union all
  select 'step 33 (0288)' as step, '0288 two bookings that overlap at different minutes can no longer both be saved at the same instant' as what, not ((not exists (select 1 from pg_trigger where tgname = 'bookings_guard_overlap'))) as in_place
  union all
  select 'step 34 (0289)' as step, '0289 a window of hours can be tagged with one of your session types' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_type_id'))) as in_place
) as result order by step;
