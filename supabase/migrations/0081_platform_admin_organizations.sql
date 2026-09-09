-- Lets a platform admin (profiles.is_platform_admin, set once on the
-- real owner account when the org tier shipped) see and create
-- organizations beyond their own — the "I'm the developer, I should be
-- able to build out a prospective client's org before handing it to
-- them" workflow. Every other write path (branding edits, revenue
-- splits, inviting coaches) is unchanged — a platform admin still needs
-- an actual organization_memberships row to do any of that inside an
-- org they don't already belong to; this only grants list/create.
create policy "organizations_select_platform_admin" on public.organizations for select
  to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and is_platform_admin)
  );

create policy "organizations_insert_platform_admin" on public.organizations for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and is_platform_admin)
  );
