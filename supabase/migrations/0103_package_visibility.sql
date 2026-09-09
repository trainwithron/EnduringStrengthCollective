-- 0100's coach_packages_client_select made every active package visible
-- to every client of that coach — no way to keep one private. Real
-- problem, not hypothetical: a coach can have genuine grandfathered
-- pricing (one long-time client at a lower rate, everyone else at the
-- standard one) and both packages would show to both clients today.
--
-- Model, confirmed with the coach directly: a package is either
-- published (is_public = true — an open menu, visible to every client
-- of the coach) or private (visible only to clients it's been
-- explicitly assigned to). A client's visible set is published ∪
-- assigned-to-them — no other stacking/precedence.
alter table public.coach_packages
  add column is_public boolean not null default false;

-- Modeled directly on workout_assignments (0029_client_calendar.sql) —
-- a coach-owned join row granting one specific athlete visibility into
-- one specific private package. No Stripe side effect (unlike
-- coach_packages itself), so written to directly from the client via
-- RLS, same pattern as session_credits/private_from_org_toggle — no API
-- route needed for this table.
create table public.package_assignments (
  id uuid primary key default uuid_generate_v4(),
  coach_package_id uuid not null references public.coach_packages(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (coach_package_id, athlete_id)
);

create index package_assignments_coach_package_id_idx on public.package_assignments(coach_package_id);
create index package_assignments_athlete_id_idx on public.package_assignments(athlete_id);

alter table public.package_assignments enable row level security;

create policy "package_assignments_coach_manage" on public.package_assignments for all
  to authenticated
  using (
    exists (
      select 1 from public.coach_packages cp
      where cp.id = package_assignments.coach_package_id
        and cp.coach_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.coach_packages cp
      where cp.id = package_assignments.coach_package_id
        and cp.coach_id = (select auth.uid())
    )
  );

create policy "package_assignments_athlete_select" on public.package_assignments for select
  to authenticated using (athlete_id = (select auth.uid()));

-- Replaces coach_packages_client_select from 0100: published, or
-- explicitly assigned — nothing more.
drop policy "coach_packages_client_select" on public.coach_packages;
create policy "coach_packages_client_select" on public.coach_packages for select
  to authenticated
  using (
    is_active and public.is_client_of_coach(coach_id) and (
      is_public or exists (
        select 1 from public.package_assignments pa
        where pa.coach_package_id = coach_packages.id and pa.athlete_id = (select auth.uid())
      )
    )
  );
