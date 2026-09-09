-- 0103's coach_packages_client_select policy queries package_assignments,
-- and package_assignments_coach_manage queries back into coach_packages —
-- Postgres evaluates both policies for any SELECT on package_assignments
-- (a FOR ALL policy applies to SELECT too), so this was a genuine infinite
-- recursion, not just a hypothetical one (reproduced live before this fix).
-- SECURITY DEFINER helpers break the cycle the same way is_client_of_coach
-- already does elsewhere in this schema — the function owner bypasses RLS,
-- so the subquery inside never re-triggers the calling table's own policy.
create or replace function public.is_coach_of_package(target_package_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.coach_packages cp
    where cp.id = target_package_id and cp.coach_id = (select auth.uid())
  );
$$;

create or replace function public.is_package_assigned_to_viewer(target_package_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.package_assignments pa
    where pa.coach_package_id = target_package_id and pa.athlete_id = (select auth.uid())
  );
$$;

drop policy "package_assignments_coach_manage" on public.package_assignments;
create policy "package_assignments_coach_manage" on public.package_assignments for all
  to authenticated
  using (public.is_coach_of_package(coach_package_id))
  with check (public.is_coach_of_package(coach_package_id));

drop policy "coach_packages_client_select" on public.coach_packages;
create policy "coach_packages_client_select" on public.coach_packages for select
  to authenticated
  using (
    is_active and public.is_client_of_coach(coach_id) and (
      is_public or public.is_package_assigned_to_viewer(id)
    )
  );
