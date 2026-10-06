-- STEP 24 (PRECHECK, run first, changes nothing): 0282 URGENT: close again the internal server-only functions that step 13 (0271) opened to every signed-in account (credit changes, booking settlement, audit writers, SMS and rate-limit bookkeeping, AI metering)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the internal functions exist',
      exists (select 1 from pg_proc where proname = 'apply_session_credit_change' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'settle_booking_internal' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'audit_record' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'reserve_ai_call' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'adjust_coach_credits' and pronamespace = 'public'::regnamespace)),
    ('0282 is not already applied (a signed-in user can still run apply_session_credit_change)',
      has_function_privilege('authenticated', 'public.apply_session_credit_change(uuid, uuid, integer, text, text, uuid, uuid)', 'execute'))
) as checks(check_name, ok);
