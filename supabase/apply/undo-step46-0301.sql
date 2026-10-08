-- UNDO for step 46 (0301). Only if step 46 misbehaves. Removes the budget helper function and the once-a-month notice record. The AI usage log itself is not touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.ai_budget_notices;
drop function if exists public.ai_month_usage(uuid, timestamptz);
commit;
