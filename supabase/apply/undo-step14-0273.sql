-- UNDO for step 14 (0273). Only if renaming a group, saving branding or transferring ownership stops working after step 14. Removes the two guards.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists organizations_guard_columns on public.organizations;
drop trigger if exists groups_guard_columns on public.groups;
drop function if exists public.guard_organization_columns();
drop function if exists public.guard_group_columns();
commit;
