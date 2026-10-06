-- STEP 11 (PRECHECK, run first, changes nothing): 0269 group session fixes: owed on promotion, not after start, credits in the right group, held time cannot be cancelled or double-booked
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0263 is applied (group_sessions and discovery_bookings exist)',
      to_regclass('public.group_sessions') is not null and to_regclass('public.discovery_bookings') is not null),
    ('0248 is applied (bookings.credit_state exists)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'credit_state')),
    ('0269 is not already applied',
      not exists (select 1 from pg_proc where proname = 'guard_group_session_bookings' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
