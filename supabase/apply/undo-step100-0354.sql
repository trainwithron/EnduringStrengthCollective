-- UNDO for step 100 (0354). Only if step 100 misbehaves. Puts back the broad write rights on memberships (so an owner could again write the connected account) and removes the 100% rule.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists organization_memberships_share_total on public.organization_memberships;
drop function if exists public.guard_organization_share_total();
grant insert, update on public.organization_memberships to authenticated, anon;
commit;
