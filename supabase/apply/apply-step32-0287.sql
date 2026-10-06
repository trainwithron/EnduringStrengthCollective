-- STEP 32: 0287 a session can be longer than the time between slot starts (a start every 15 minutes with a 55-minute session); the session still has to fit inside its window
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once and no existing hours change. After the code deploy a coach can set Slot every 15 (or 5, 10, 20, 30) minutes together with a session length of 55 or 60: starts overlap, and booking one blocks the others it overlaps. Run this after step 25.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((exists (select 1 from pg_constraint where conname = 'coach_availability_windows_session_minutes_range' and pg_get_constraintdef(oid) like '%slot_duration_minutes%'))) then
    raise exception 'Step 32 (0287) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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

commit;
