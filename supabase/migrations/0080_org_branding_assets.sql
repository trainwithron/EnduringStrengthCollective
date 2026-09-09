-- White-label branding assets: an org's home-screen app icon (distinct
-- from logo_url, which is used for in-app headers/wide contexts — the
-- app icon needs to be a square/maskable image for the PWA manifest).
alter table public.organizations add column app_icon_url text;

-- Public bucket: logos/icons render on every page load (including the
-- athlete mobile app and the PWA manifest itself), so a plain public URL
-- is used instead of per-request signed URLs. RLS below still gates who
-- can write into it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('org-branding', 'org-branding', true, 5242880) -- public, 5MB cap
on conflict (id) do nothing;

create policy "org_branding_insert_owner_admin" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id = (storage.foldername(name))[1]::uuid
        and om.profile_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );

create policy "org_branding_update_owner_admin" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id = (storage.foldername(name))[1]::uuid
        and om.profile_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  )
  with check (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id = (storage.foldername(name))[1]::uuid
        and om.profile_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );

create policy "org_branding_delete_owner_admin" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id = (storage.foldername(name))[1]::uuid
        and om.profile_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );
