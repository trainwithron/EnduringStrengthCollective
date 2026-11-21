-- Wave 3, calendar and requests (Ron, Nov 20). Re-running is safe.

-- C1: a coach is warned about two hours before a waiting session request lapses, and told once it has (lib/request-lapse-job.ts, run by the five-minute booking job). When
-- a request lapses is unchanged (expire_stale_booking_requests). Each message is claimed once on the request, so it goes out once.
alter table public.booking_requests add column if not exists lapse_warned_at timestamptz;
alter table public.booking_requests add column if not exists lapse_told_at timestamptz;
