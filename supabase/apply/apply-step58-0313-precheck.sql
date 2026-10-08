-- STEP 58 (PRECHECK, run first, changes nothing): 0313 Session counts worked out in the database for large rosters: one function (booking_counts) returns booked, to mark and prepaid-ahead per client and group, with a small index, so the pages that show "8 left · 4 booked · 2 to mark" stay fast and complete with 500+ clients
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('bookings exists',
      to_regclass('public.bookings') is not null),
    ('0313 is not already applied (booking_counts is not there yet)',
      not exists (select 1 from pg_proc where proname = 'booking_counts' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
