-- Recurring sessions that can run with no end, be paused, ended and extended, and are kept booked a rolling 12 weeks ahead.
--
-- A series used to be a fixed count (up to 52 after 0248) booked all at once. This keeps that and adds:
--   * mode 'ongoing': no end date; a daily job books the next 12 weeks (window_weeks) so the calendar is never empty ahead.
--   * paused / ended: a paused series books nothing new; an ended one is finished. Future sessions are cancelled by the app.
--   * skipped_starts: weeks the coach removed or moved on purpose, so the daily top-up never books them back.
--   * anchor_date + timezone: the first session's local date and the coach's zone, so "6:00 every Tuesday" stays 6:00
--     across daylight saving when more weeks are booked later.
-- The series row is only ever written by the server (service role) after it checks the caller coaches the group; clients
-- and coaches still have no direct write policy, same as before. Requires 0210 and 0248.

alter table public.recurring_booking_series
  add column if not exists mode text not null default 'fixed',
  add column if not exists timezone text,
  add column if not exists anchor_date date,
  add column if not exists window_weeks int not null default 12,
  add column if not exists ends_on date,
  add column if not exists skipped_starts timestamptz[] not null default '{}',
  add column if not exists paused_at timestamptz,
  add column if not exists paused_remaining int,
  add column if not exists last_topped_up_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_mode_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_mode_check check (mode in ('fixed', 'ongoing'));

alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_window_weeks_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_window_weeks_check check (window_weeks between 1 and 52);

-- An ongoing series has no total.
alter table public.recurring_booking_series alter column occurrences_total drop not null;
alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_occurrences_total_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_occurrences_total_check
  check (occurrences_total is null or (occurrences_total > 0 and occurrences_total <= 52));
alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_mode_total_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_mode_total_check
  check (mode = 'ongoing' or occurrences_total is not null);

alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_status_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_status_check check (status in ('active', 'paused', 'ended', 'cancelled'));

create index if not exists recurring_booking_series_status_idx on public.recurring_booking_series (status, mode);
create index if not exists bookings_recurring_series_idx on public.bookings (recurring_series_id, start_at)
  where recurring_series_id is not null;
