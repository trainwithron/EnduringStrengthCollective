-- A session length that is separate from how often slots start (Ron, Oct 6): "you have a full hour to give but expect 55". A window's slot_duration_minutes is
-- the step (a bookable slot starts every N minutes) and, until now, also how long the booked session lasts. session_minutes lets a coach keep 60-minute
-- slots with 55-minute sessions, leaving a 5-minute gap, or any other length up to the step.
--
--  * coach_availability_windows.session_minutes: null means "the same as the slot step", so every existing window behaves exactly as it did.
--    Between 5 and 480 minutes and never longer than the step (sessions in neighbouring slots must not overlap).
-- Nothing else changes: the booking functions already take the end time from the caller and check the overlap with other bookings and the coach's buffer on
-- the real end times (book_session and reschedule_booking do NOT check weekly hours or time off: only the request functions, through coach_time_is_open,
-- check that [start, end] sits inside a window), so a 55-minute session at 06:00 then another at 07:00 works with a buffer of 5 or less. The app reads the new column wherever it builds slots (the calendar, booking and request screens, weekly schedules, the public booking page,
-- conflict checks), and ignores it until this is applied.
-- Needs coach_availability_windows (0023). Re-runnable.

alter table public.coach_availability_windows
  add column if not exists session_minutes int;

alter table public.coach_availability_windows
  drop constraint if exists coach_availability_windows_session_minutes_range;
alter table public.coach_availability_windows
  add constraint coach_availability_windows_session_minutes_range
  check (session_minutes is null or (session_minutes between 5 and 480 and session_minutes <= slot_duration_minutes));
