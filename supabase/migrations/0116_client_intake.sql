-- PAR-Q+ / liability waiver intake, hard-gated for newly added clients.
-- Format confirmed: real coach-editable waiver text (or an optional
-- coach-uploaded PDF override), typed-name + checkbox + timestamp
-- signature — no third-party e-sign vendor. Gating confirmed: a hard
-- gate, but only for clients added going forward (intake_required
-- starts false for every existing profile, set true only by the Add
-- Client route from here on) — never retroactive.

alter table public.organizations
  add column waiver_text text,
  add column waiver_pdf_path text;

alter table public.profiles
  add column intake_required boolean not null default false;

create table public.client_intake (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  par_q_answers jsonb not null default '[]'::jsonb,
  waiver_signed_name text,
  waiver_accepted boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_intake_group_id_idx on public.client_intake(group_id);

alter table public.client_intake enable row level security;

-- Self-reported, same as wellness_checkins — a coach can read it (to
-- confirm it's on file) but never write it on the athlete's behalf.
create policy "client_intake_select_own_or_coach" on public.client_intake for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "client_intake_write_own" on public.client_intake for all
  to authenticated using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));

-- The existing organizations_update_owner policy (0049) is owner-only;
-- an org admin (not just the owner) should also be able to edit their
-- own waiver text/PDF — additive permissive policy, same pattern as
-- every other "coach vs org-admin" split already in this app.
create policy "organizations_update_org_admin" on public.organizations for update
  to authenticated
  using (exists (
    select 1 from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.profile_id = (select auth.uid())
      and om.role in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.profile_id = (select auth.uid())
      and om.role in ('owner', 'admin')
  ));

-- Storage: private bucket for a coach's own uploaded waiver PDF, path
-- {organization_id}/{uuid}.pdf — same "first folder segment is the
-- RLS-checkable id" convention as every other bucket in this app.
insert into storage.buckets (id, name, public, file_size_limit)
values ('waiver-documents', 'waiver-documents', false, 10485760) -- private, 10MB cap
on conflict (id) do nothing;

create policy "waiver_documents_select_org_member"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'waiver-documents'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy "waiver_documents_insert_org_admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'waiver-documents'
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id = (storage.foldername(name))[1]::uuid
        and om.profile_id = (select auth.uid())
        and om.role in ('owner', 'admin')
    )
  );

create policy "waiver_documents_delete_org_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'waiver-documents'
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id = (storage.foldername(name))[1]::uuid
        and om.profile_id = (select auth.uid())
        and om.role in ('owner', 'admin')
    )
  );
