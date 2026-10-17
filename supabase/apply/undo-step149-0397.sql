-- UNDO for step 149 (0397). Only if step 149 misbehaves. Nothing else depends on it.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists group_memberships_free_tier_limit on public.group_memberships;
drop function if exists public.enforce_free_tier_client_limit();
drop function if exists public._org_training_clients(uuid);
drop function if exists public.org_is_free_tier(uuid);
drop function if exists public.free_tier_clients_enforced();
commit;
