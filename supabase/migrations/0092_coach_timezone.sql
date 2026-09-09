-- Booking/scheduling had no timezone handling at all (see lib/timezone.ts
-- for the full write-up): coach_availability_windows' start_time/end_time
-- are the coach's own local wall-clock hours, but nothing recorded which
-- timezone that actually meant, and slot generation used plain
-- date.setHours() — always local-to-whatever-machine-runs-the-code, which
-- is UTC on every server-rendered page/API route. This is the missing
-- piece: a real IANA timezone per coach.
alter table public.profiles add column timezone text;
