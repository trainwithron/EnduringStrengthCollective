-- groups_insert_authenticated only ever checked created_by, never that the
-- creator actually belongs to the org they're pointing the new group at —
-- organization_id became a required column (0049) after this policy was
-- written and nothing tightened it since. Never exploited (grep confirms
-- no code path has ever called groups.insert until the group switcher
-- being added now), but real: any authenticated user could otherwise
-- create a group under an org they have no relationship to. Scoped to
-- owner/admin specifically, matching who the switcher lets create groups.
drop policy if exists "groups_insert_authenticated" on public.groups;
create policy "groups_insert_authenticated"
  on public.groups for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.organization_memberships om
      -- Qualified as groups.organization_id, not the bare column name —
      -- an unqualified reference here resolves against om (the closest
      -- scope) instead of the row being inserted, since organization_id
      -- also exists on organization_memberships. Caught live: the
      -- unqualified version rejected every insert.
      where om.organization_id = groups.organization_id
        and om.profile_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );
