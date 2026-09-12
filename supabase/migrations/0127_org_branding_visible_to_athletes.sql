-- Real bug found during a pre-migration readiness pass: athletes never
-- get an organization_memberships row (only coaches/owners do — that
-- table is org-*staff* membership, athletes aren't staff). Every RLS
-- policy gated on is_org_member() therefore silently rejects an athlete
-- entirely, even for the "organizations" table's own SELECT policy,
-- which is where org branding (name/colors/fonts/logo) AND the coach's
-- waiver text/PDF path both live. The application code path
-- (app/intake/page.tsx) already correctly derives the org id via the
-- athlete's own group -> groups.organization_id — it never touches
-- organization_memberships at all — but RLS blocked the read anyway,
-- so org?.name/waiver_text/waiver_pdf_path all silently came back null
-- and every real athlete has been getting the hardcoded default theme
-- and the generic built-in waiver template instead of whatever the
-- coach actually configured.
--
-- Deliberately NOT broadening is_org_member() itself — it's also used
-- by support_requests' RLS (coach<->platform-admin support tickets),
-- and making every group member (including athletes) count as an
-- "org member" there would let an athlete read their coach's private
-- support/billing conversations with Ron. This new function is scoped
-- to exactly the two policies that genuinely need athlete-readability:
-- org branding itself, and the coach's uploaded waiver PDF.
create or replace function public.can_view_org_branding(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org_id)
    or exists (
      select 1
      from public.group_memberships gm
      join public.groups g on g.id = gm.group_id
      where gm.profile_id = (select auth.uid())
        and g.organization_id = target_org_id
    );
$$;

drop policy "organizations_select_member_or_platform_admin" on public.organizations;
create policy "organizations_select_member_or_platform_admin" on public.organizations for select
  to authenticated using (
    public.can_view_org_branding(id)
    or exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.is_platform_admin)
  );

drop policy "waiver_documents_select_org_member" on storage.objects;
create policy "waiver_documents_select_org_member"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'waiver-documents'
    and public.can_view_org_branding((storage.foldername(name))[1]::uuid)
  );
