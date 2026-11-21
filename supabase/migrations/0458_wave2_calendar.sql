-- Wave 2, calendar and team (Ron, Nov 20). Re-running is safe.

-- C2: the day-before reminder, timed to the coach's cancel window (app/api/cron/session-reminder, lib/day-before-reminder.ts). The start time it was sent for, so a
-- session moved to a new time gets a fresh one and nothing else has to reset it.
alter table public.bookings add column if not exists day_before_reminded_for timestamptz;
