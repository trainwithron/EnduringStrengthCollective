-- Organizational client tags (organizational_only_group_kind_idea_
-- sept16.md) — Ron's own idea: a lightweight, org-scoped way to
-- segment clients ("In-Home" vs "Coast to Coast" vs "Pay-Split
-- Clients") without creating a real `groups` row, which would silently
-- inherit real billing/programming/booking weight nothing here should
-- carry. Explicitly rejected as a 4th group_kind value (see the
-- scoping memory) — groups already carry too much structural meaning
-- for a purely organizational label to safely piggyback on.
create table public.client_tags (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  -- One designated tag per org can gate the revenue-split transfer
  -- logic (see createRevenueSplitTransfers) — "is this specific paying
  -- client one the org owner actually sourced." Not set by default; the
  -- org-wide split behaves exactly as it did before this feature until
  -- an org owner deliberately flags a tag for this.
  gates_revenue_split boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index client_tags_organization_id_idx on public.client_tags(organization_id);

-- At most one gating tag per org — the revenue-split gate needs an
-- unambiguous single answer to "which tag means pay-split-eligible,"
-- not a coach picking between several.
create unique index client_tags_one_revenue_split_gate_per_org
  on public.client_tags(organization_id) where gates_revenue_split;

create table public.client_tag_assignments (
  id uuid primary key default uuid_generate_v4(),
  tag_id uuid not null references public.client_tags(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (tag_id, athlete_id)
);
create index client_tag_assignments_tag_id_idx on public.client_tag_assignments(tag_id);
create index client_tag_assignments_athlete_id_idx on public.client_tag_assignments(athlete_id);

alter table public.client_tags enable row level security;
create policy "client_tags_select_org_member" on public.client_tags for select
  to authenticated using (public.is_org_member(organization_id));
create policy "client_tags_write_org_member" on public.client_tags for all
  to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

alter table public.client_tag_assignments enable row level security;
create policy "client_tag_assignments_select_org_member" on public.client_tag_assignments for select
  to authenticated using (
    exists (select 1 from public.client_tags t where t.id = tag_id and public.is_org_member(t.organization_id))
  );
create policy "client_tag_assignments_write_org_member" on public.client_tag_assignments for all
  to authenticated
  using (exists (select 1 from public.client_tags t where t.id = tag_id and public.is_org_member(t.organization_id)))
  with check (exists (select 1 from public.client_tags t where t.id = tag_id and public.is_org_member(t.organization_id)));
