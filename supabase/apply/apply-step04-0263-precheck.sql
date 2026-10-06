-- STEP 04 (PRECHECK, run first, changes nothing): 0263 small-group sessions with spots, waiting list and charges
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0246 and 0248 are applied (credit functions exist)',
      exists (select 1 from pg_proc where proname = 'apply_session_credit_change' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'settle_booking_internal' and pronamespace = 'public'::regnamespace) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'credit_state')),
    ('bookings, session_types, coach_booking_policies, session_credits, session_credit_ledger exist',
      to_regclass('public.bookings') is not null and to_regclass('public.session_types') is not null and to_regclass('public.coach_booking_policies') is not null and to_regclass('public.session_credits') is not null and to_regclass('public.session_credit_ledger') is not null),
    ('is_group_coach and is_client_of_coach exist',
      exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_client_of_coach' and pronamespace = 'public'::regnamespace)),
    ('0263 is not already applied',
      to_regclass('public.group_sessions') is null)
) as checks(check_name, ok);
