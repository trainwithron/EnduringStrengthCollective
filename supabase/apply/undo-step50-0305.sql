-- UNDO for step 50 (0305). Only if step 50 misbehaves. Removes the record of what past months drew from the top-up balance (the balance then reads as everything ever bought).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.ai_topup_draws;
commit;
