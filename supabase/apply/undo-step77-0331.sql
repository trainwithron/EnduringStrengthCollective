-- UNDO for step 77 (0331). Only if step 77 misbehaves. Removes the two functions. The payment handler of the new code needs them, so undo this only together with going back to the previous code.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text);
drop function if exists public.grant_subscription_credits_once(text, uuid, uuid, uuid, integer, text);
commit;
