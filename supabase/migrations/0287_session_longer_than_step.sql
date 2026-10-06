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
