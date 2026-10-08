-- STEP 50 (PRECHECK, run first, changes nothing): 0305 AI top-up balance that carries over: a small server-only record of how much of the top-up balance each month used, so a paid top-up is spent after the month's included AI and the rest carries into the next month
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('organizations exists',
      to_regclass('public.organizations') is not null),
    ('step 46 is applied (ai_budget_topups exists)',
      to_regclass('public.ai_budget_topups') is not null),
    ('0305 is not already applied (ai_topup_draws is not there yet)',
      to_regclass('public.ai_topup_draws') is null)
) as checks(check_name, ok);
