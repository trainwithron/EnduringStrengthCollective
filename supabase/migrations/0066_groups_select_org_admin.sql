-- An org owner/admin needs to be able to SEE every group in their own
-- organization to pick one as a duplication destination, even before
-- they've joined it as a coach (joining happens only once they actually
-- pick one, via the existing self-provisioning insert on
-- group_memberships from migration 0060). groups_select_members alone
-- (is_group_member(id)) can't do this — that's exactly the same
-- chicken-and-egg problem migration 0060 solved for group_memberships,
-- one level up, on groups itself. Reuses the same is_org_admin_of_group
-- helper already built for the group switcher.
create policy "groups_select_org_admin" on public.groups for select
  to authenticated using (public.is_org_admin_of_group(id));
