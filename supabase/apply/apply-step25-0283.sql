-- STEP 25: 0283 session length separate from the slot step: a window can keep 60-minute slots with 55-minute sessions (a 5-minute gap), or any length up to the step
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for anyone at once: every existing window has no session length, which means the same as its slot step. After the code deploy, on the Availability page: pick a Session length for all your hours (30, 40, 45, 50, 55, 60 or your own), or set it per window. Slots keep starting every slot step; each booking lasts the session length. For 06:00 to 06:55 then 07:00 to 07:55: windows with a slot every 60 minutes, session length 55, and a buffer of 5 or less under Booking rules.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_minutes'))) then
    raise exception 'Step 25 (0283) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0283_availability_session_length.sql
-- ====================================================================================================

-- A session length that is separate from how often slots start (Ron, Oct 6): "you have a full hour to give but expect 55". A window's slot_duration_minutes is
-- the step (a bookable slot starts every N minutes) and, until now, also how long the booked session lasts. session_minutes lets a coach keep 60-minute
-- slots with 55-minute sessions, leaving a 5-minute gap, or any other length up to the step.
--
--  * coach_availability_windows.session_minutes: null means "the same as the slot step", so every existing window behaves exactly as it did.
--    Between 5 and 480 minutes and never longer than the step (sessions in neighbouring slots must not overlap).
-- Nothing else changes: the booking functions already take the end time from the caller and check that [start, end] sits inside a window, clear of time
-- off, and that the gap to other bookings is at least the coach's buffer, so a 55-minute session at 06:00 then another at 07:00 works with a buffer of 5
-- or less. The app reads the new column wherever it builds slots (the calendar, booking and request screens, weekly schedules, the public booking page,
-- conflict checks), and ignores it until this is applied.
-- Needs coach_availability_windows (0023). Re-runnable.

alter table public.coach_availability_windows
  add column if not exists session_minutes int;

alter table public.coach_availability_windows
  drop constraint if exists coach_availability_windows_session_minutes_range;
alter table public.coach_availability_windows
  add constraint coach_availability_windows_session_minutes_range
  check (session_minutes is null or (session_minutes between 5 and 480 and session_minutes <= slot_duration_minutes));

commit;
