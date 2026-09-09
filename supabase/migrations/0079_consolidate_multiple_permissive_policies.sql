-- Performance advisor: multiple_permissive_policies. Two permissive
-- policies for the same role+action get OR'd together at runtime, each
-- evaluated separately per row — merging them into one policy with an
-- OR'd condition is semantically identical (permissive policies were
-- always OR logic) but only evaluated once. Only touches the 5 pairs
-- that genuinely target the same role+action; several other flagged
-- pairs (e.g. posts_select_members vs. posts_select_public_workout_share)
-- pair an `authenticated` policy with an unrelated `anon` one — those
-- never double-evaluate for a single request and are left untouched.

drop policy "athlete_exercise_overrides_write_coach" on public.athlete_exercise_overrides;
drop policy "athlete_exercise_overrides_write_self" on public.athlete_exercise_overrides;
create policy "athlete_exercise_overrides_write_self_or_coach" on public.athlete_exercise_overrides for all
  to authenticated
  using ((athlete_id = (select auth.uid())) or is_group_coach(group_id))
  with check ((athlete_id = (select auth.uid())) or is_group_coach(group_id));

drop policy "bookings_insert_by_coach" on public.bookings;
drop policy "bookings_insert_own_client" on public.bookings;
create policy "bookings_insert_by_coach_or_own_client" on public.bookings for insert
  to authenticated
  with check (
    ((coach_id = (select auth.uid())) and is_group_coach(group_id))
    or ((athlete_id = (select auth.uid())) and is_client_of_coach(coach_id))
  );

drop policy "exercise_library_select_group_member" on public.exercise_library;
drop policy "exercise_library_select_own" on public.exercise_library;
create policy "exercise_library_select_own_or_group_member" on public.exercise_library for select
  to authenticated
  using (
    (created_by = (select auth.uid()))
    or (exists (
      select 1 from group_memberships gm_coach
      join group_memberships gm_viewer on gm_viewer.group_id = gm_coach.group_id
      where gm_coach.profile_id = exercise_library.created_by
        and gm_coach.role = 'coach'::member_role
        and gm_viewer.profile_id = (select auth.uid())
    ))
  );

drop policy "groups_select_members" on public.groups;
drop policy "groups_select_org_admin" on public.groups;
create policy "groups_select_members_or_org_admin" on public.groups for select
  to authenticated
  using (is_group_member(id) or is_org_admin_of_group(id));

drop policy "posts_update_own" on public.posts;
drop policy "posts_update_coach_pin" on public.posts;
create policy "posts_update_own_or_coach" on public.posts for update
  to authenticated
  using ((author_id = (select auth.uid())) or is_group_coach(group_id))
  with check ((author_id = (select auth.uid())) or is_group_coach(group_id));
