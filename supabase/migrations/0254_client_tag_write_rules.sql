-- Client tags: who may change what.
--
-- 0202 let ANY member of an organization create, rename, delete and flag tags, and assign any tag to any person, through
-- "for all" policies. The tag that gates revenue splitting decides which clients' payments are split with the owner, so a
-- trainer could flip that flag or tag/untag clients to change who gets paid, though the screens say only owners and admins
-- manage tags. Now, enforced in the database:
--   * only an owner or admin of the organization creates, edits or deletes tags (including the revenue-split flag);
--   * any member may still see tags, and may assign or remove a tag that does NOT gate revenue;
--   * assigning or removing the revenue-splitting tag needs an owner or admin;
--   * the person being tagged must belong to a group in that organization.

create or replace function public.is_org_owner_or_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships om
    where om.organization_id = target_org_id
      and om.profile_id = (select auth.uid())
      and om.role in ('owner', 'admin')
  );
$$;

-- Is this person a client in some group of this organization? Security definer because the owner or admin who assigns a tag is often not a
-- member of that group, so they cannot see its memberships under their own row security. Only answers for organization members.
create or replace function public.athlete_in_org(target_athlete_id uuid, target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org_id)
    and exists (
      select 1 from public.group_memberships gm
      join public.groups g on g.id = gm.group_id
      where gm.profile_id = target_athlete_id
        and g.organization_id = target_org_id
    );
$$;

drop policy if exists "client_tags_write_org_member" on public.client_tags;
create policy "client_tags_insert_owner_admin" on public.client_tags for insert
  to authenticated with check (public.is_org_owner_or_admin(organization_id));
create policy "client_tags_update_owner_admin" on public.client_tags for update
  to authenticated using (public.is_org_owner_or_admin(organization_id)) with check (public.is_org_owner_or_admin(organization_id));
create policy "client_tags_delete_owner_admin" on public.client_tags for delete
  to authenticated using (public.is_org_owner_or_admin(organization_id));

drop policy if exists "client_tag_assignments_write_org_member" on public.client_tag_assignments;

create policy "client_tag_assignments_insert" on public.client_tag_assignments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.client_tags t
      where t.id = tag_id
        and public.is_org_member(t.organization_id)
        and (not t.gates_revenue_split or public.is_org_owner_or_admin(t.organization_id))
        and public.athlete_in_org(client_tag_assignments.athlete_id, t.organization_id)
    )
  );

create policy "client_tag_assignments_delete" on public.client_tag_assignments for delete
  to authenticated
  using (
    exists (
      select 1 from public.client_tags t
      where t.id = tag_id
        and public.is_org_member(t.organization_id)
        and (not t.gates_revenue_split or public.is_org_owner_or_admin(t.organization_id))
    )
  );
