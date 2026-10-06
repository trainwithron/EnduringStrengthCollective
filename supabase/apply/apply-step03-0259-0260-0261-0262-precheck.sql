-- STEP 03 (PRECHECK, run first, changes nothing): 0259 ongoing weekly series, 0260 payment holds and re-up reminders, 0261 public booking page tables, 0262 job monitoring
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0248 is applied (bookings.credit_state exists)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'credit_state')),
    ('recurring_booking_series, session_credits, coach_booking_policies, session_types exist',
      to_regclass('public.recurring_booking_series') is not null and to_regclass('public.session_credits') is not null and to_regclass('public.coach_booking_policies') is not null and to_regclass('public.session_types') is not null),
    ('is_platform_admin() exists',
      to_regprocedure('public.is_platform_admin()') is not null),
    ('0261 and 0262 are not already applied',
      to_regclass('public.coach_booking_pages') is null and to_regclass('public.cron_runs') is null)
) as checks(check_name, ok);
