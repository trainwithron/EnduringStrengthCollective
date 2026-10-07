-- STEP 38 (PRECHECK, run first, changes nothing): 0293 a signed-in coach can no longer refund their own meal-plan or program charge by claiming the generation failed: that refund becomes server-only, and the coach's own 'This was wrong' button keeps working
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('ai_charges, ai_output_refunds and coach_credits exist (0245 is applied)',
      to_regclass('public.ai_charges') is not null and to_regclass('public.ai_output_refunds') is not null and to_regclass('public.coach_credits') is not null),
    ('refund_coach_credit exists',
      to_regprocedure('public.refund_coach_credit(text, text, text, text)') is not null),
    ('0293 is not already applied (the server-only refund function is not there yet)',
      not exists (select 1 from pg_proc where proname = 'refund_coach_credit_for' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
