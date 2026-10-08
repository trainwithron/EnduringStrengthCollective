-- STEP 46 (PRECHECK, run first, changes nothing): 0301 AI budget: this month's AI use per coach summed by model (server-only), and a record that a coach was told their AI is running low or used up, once per month
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('ai_usage_log exists',
      to_regclass('public.ai_usage_log') is not null),
    ('0301 is not already applied (ai_month_usage is not there yet)',
      not exists (select 1 from pg_proc where proname = 'ai_month_usage' and pronamespace = 'public'::regnamespace)),
    ('0301 is not already applied (ai_budget_notices is not there yet)',
      to_regclass('public.ai_budget_notices') is null)
) as checks(check_name, ok);
