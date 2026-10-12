-- UNDO for step 89 (0343). Only if step 89 misbehaves. Removes the two functions. Do NOT undo after the new app code is live (it would then fail to grant credits); undo only before, or deploy the previous code first.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.grant_coach_credit_pack_once(text, text, uuid, integer, integer);
drop function if exists public.grant_lift_off_credits_once(text, uuid, integer);
commit;
