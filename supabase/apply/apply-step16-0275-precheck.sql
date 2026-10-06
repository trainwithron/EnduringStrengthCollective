-- STEP 16 (PRECHECK, run first, changes nothing): 0275 a client's cancel or move of one week of an ongoing weekly schedule stays skipped (so the nightly top-up does not book it back)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0259 is applied (recurring_booking_series.skipped_starts and mode exist)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring_booking_series' and column_name = 'skipped_starts') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring_booking_series' and column_name = 'mode')),
    ('bookings.recurring_series_id exists',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'recurring_series_id')),
    ('0275 is not already applied',
      not exists (select 1 from pg_trigger where tgname = 'bookings_note_series_skip'))
) as checks(check_name, ok);
