-- UNDO for step 46 (0301). Only if step 46 misbehaves. Removes the budget helper functions, the top-up record and the once-a-month notice record (a paid top-up recorded since would be lost from the budget; the payment itself is in Stripe). The AI usage log itself is not touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.ai_budget_notices;
drop table if exists public.ai_budget_topups;
drop function if exists public.ai_org_month_usage(uuid, timestamptz);
drop function if exists public.ai_org_summary(uuid);
commit;
