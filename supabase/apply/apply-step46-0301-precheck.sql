-- STEP 46 (PRECHECK, run first, changes nothing): 0301 AI budget: one pool per organization (its size, and this month's AI use summed by model, both server-only), paid top-up packs added to a month's budget, and a record that the owner and coach were told the AI is running low or used up, once per month
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('ai_usage_log exists',
      to_regclass('public.ai_usage_log') is not null),
    ('organizations, organization_billing, organization_memberships and coach_credits exist (the budget reads them)',
      to_regclass('public.organizations') is not null and to_regclass('public.organization_billing') is not null and to_regclass('public.organization_memberships') is not null and to_regclass('public.coach_credits') is not null),
    ('0301 is not already applied (ai_org_summary is not there yet)',
      not exists (select 1 from pg_proc where proname = 'ai_org_summary' and pronamespace = 'public'::regnamespace)),
    ('0301 is not already applied (ai_budget_notices is not there yet)',
      to_regclass('public.ai_budget_notices') is null)
) as checks(check_name, ok);
