-- STEP 33 (PRECHECK, run first, changes nothing): 0288 two bookings that overlap at different minutes can no longer both be saved at the same instant (a lock per coach, then a second overlap check before a confirmed future booking is saved or moved)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('bookings and discovery_bookings exist',
      to_regclass('public.bookings') is not null and to_regclass('public.discovery_bookings') is not null),
    ('0288 is not already applied (the overlap guard is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'bookings_guard_overlap'))
) as checks(check_name, ok);
