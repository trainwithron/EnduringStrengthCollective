-- calorie_tracking_ux_research_and_plan.md — guardian-visibility page,
-- RESOLVED 2026-09-16: stays free, deliberately positioned as a
-- marketing wedge (Ron's own call), not a paywalled tier feature.
--
-- Same shape as groups.public_invite_code (migration 0074) — a random
-- token IS the access control, not a parent account/login. The actual
-- read path (app/guardian/[token]/page.tsx) goes through a service-role
-- client keyed on this exact token, same pattern as
-- lib/shared-milestone.ts — so this table needs no anon RLS policy at
-- all, only coach-side CRUD.
create table public.guardian_links (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  access_token text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index guardian_links_athlete_group_idx on public.guardian_links(athlete_id, group_id);

alter table public.guardian_links enable row level security;

create policy "guardian_links_coach_manage" on public.guardian_links for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
