-- Consolidates the ~35 remaining "multiple permissive policies" advisor
-- findings left deliberately unaddressed in 0107 (that pass only fixed
-- the auth_rls_initplan wrapping + 3 trivial cases; this finishes the
-- rest now that it's been carefully mapped table-by-table).
--
-- The shape in every case: a coach/owner "FOR ALL" policy overlaps with
-- a separate SELECT-only policy for the same table, so Postgres
-- evaluates both permissive policies on every read. Two fixes, chosen
-- per table by whether the SELECT policy's own predicate already
-- happens to include the ALL policy's condition as one of its OR terms:
--
--   (a) SELECT already self-covers it (e.g. `athlete_id = uid() OR
--       is_group_coach(group_id)` already matches what the coach's ALL
--       policy would grant) — just split the ALL policy into
--       insert/update/delete-only, same predicate, SELECT untouched.
--   (b) SELECT does NOT already cover it (e.g. select is athlete-only,
--       with no coach term at all) — merge the coach's predicate into
--       SELECT with OR, then split the ALL policy the same way.
--
-- Every predicate below is copied verbatim from what it replaces (or
-- OR'd together verbatim) — no access-control logic is being invented,
-- only reorganized so each command matches exactly one policy.

-- ============================================================
-- (a) SELECT already self-covers — split ALL into insert/update/delete
-- ============================================================

drop policy "athlete_exercise_overrides_write_self_or_coach" on public.athlete_exercise_overrides;
create policy "athlete_exercise_overrides_insert_self_or_coach" on public.athlete_exercise_overrides for insert
  to authenticated with check ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "athlete_exercise_overrides_update_self_or_coach" on public.athlete_exercise_overrides for update
  to authenticated
  using ((athlete_id = (select auth.uid())) or is_group_coach(group_id))
  with check ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "athlete_exercise_overrides_delete_self_or_coach" on public.athlete_exercise_overrides for delete
  to authenticated using ((athlete_id = (select auth.uid())) or is_group_coach(group_id));

drop policy "weight_logs_write_own_or_coach" on public.body_weight_logs;
create policy "weight_logs_insert_own_or_coach" on public.body_weight_logs for insert
  to authenticated with check ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "weight_logs_update_own_or_coach" on public.body_weight_logs for update
  to authenticated
  using ((athlete_id = (select auth.uid())) or is_group_coach(group_id))
  with check ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "weight_logs_delete_own_or_coach" on public.body_weight_logs for delete
  to authenticated using ((athlete_id = (select auth.uid())) or is_group_coach(group_id));

drop policy "challenge_habits_coach_manage" on public.challenge_habits;
create policy "challenge_habits_insert_coach" on public.challenge_habits for insert
  to authenticated with check (exists (select 1 from public.challenges c where c.id = challenge_habits.challenge_id and c.coach_id = (select auth.uid())));
create policy "challenge_habits_update_coach" on public.challenge_habits for update
  to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_habits.challenge_id and c.coach_id = (select auth.uid())))
  with check (exists (select 1 from public.challenges c where c.id = challenge_habits.challenge_id and c.coach_id = (select auth.uid())));
create policy "challenge_habits_delete_coach" on public.challenge_habits for delete
  to authenticated using (exists (select 1 from public.challenges c where c.id = challenge_habits.challenge_id and c.coach_id = (select auth.uid())));

drop policy "challenge_habit_logs_write_own" on public.challenge_habit_logs;
create policy "challenge_habit_logs_insert_own" on public.challenge_habit_logs for insert
  to authenticated with check (profile_id = (select auth.uid()));
create policy "challenge_habit_logs_update_own" on public.challenge_habit_logs for update
  to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "challenge_habit_logs_delete_own" on public.challenge_habit_logs for delete
  to authenticated using (profile_id = (select auth.uid()));

drop policy "programs_write_coach" on public.programs;
create policy "programs_insert_coach" on public.programs for insert to authenticated with check (is_group_coach(group_id));
create policy "programs_update_coach" on public.programs for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "programs_delete_coach" on public.programs for delete to authenticated using (is_group_coach(group_id));

drop policy "workouts_write_coach" on public.workouts;
create policy "workouts_insert_coach" on public.workouts for insert to authenticated with check (is_group_coach(group_id));
create policy "workouts_update_coach" on public.workouts for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "workouts_delete_coach" on public.workouts for delete to authenticated using (is_group_coach(group_id));

drop policy "workout_notes_write_coach" on public.workout_notes;
create policy "workout_notes_insert_coach" on public.workout_notes for insert to authenticated with check (is_group_coach(group_id));
create policy "workout_notes_update_coach" on public.workout_notes for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "workout_notes_delete_coach" on public.workout_notes for delete to authenticated using (is_group_coach(group_id));

drop policy "exercise_progressions_write_coach" on public.exercise_progressions;
create policy "exercise_progressions_insert_coach" on public.exercise_progressions for insert to authenticated with check (is_group_coach(group_id));
create policy "exercise_progressions_update_coach" on public.exercise_progressions for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "exercise_progressions_delete_coach" on public.exercise_progressions for delete to authenticated using (is_group_coach(group_id));

drop policy "group_positions_write_coach" on public.group_positions;
create policy "group_positions_insert_coach" on public.group_positions for insert to authenticated with check (is_group_coach(group_id));
create policy "group_positions_update_coach" on public.group_positions for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "group_positions_delete_coach" on public.group_positions for delete to authenticated using (is_group_coach(group_id));

drop policy "gwe_write_coach" on public.group_workout_exercises;
create policy "gwe_insert_coach" on public.group_workout_exercises for insert to authenticated with check (is_group_coach(group_id));
create policy "gwe_update_coach" on public.group_workout_exercises for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "gwe_delete_coach" on public.group_workout_exercises for delete to authenticated using (is_group_coach(group_id));

drop policy "gwes_write_coach" on public.group_workout_exercise_sets;
create policy "gwes_insert_coach" on public.group_workout_exercise_sets for insert
  to authenticated with check (exists (select 1 from public.group_workout_exercises g where g.id = group_workout_exercise_sets.group_workout_exercise_id and is_group_coach(g.group_id)));
create policy "gwes_update_coach" on public.group_workout_exercise_sets for update
  to authenticated
  using (exists (select 1 from public.group_workout_exercises g where g.id = group_workout_exercise_sets.group_workout_exercise_id and is_group_coach(g.group_id)))
  with check (exists (select 1 from public.group_workout_exercises g where g.id = group_workout_exercise_sets.group_workout_exercise_id and is_group_coach(g.group_id)));
create policy "gwes_delete_coach" on public.group_workout_exercise_sets for delete
  to authenticated using (exists (select 1 from public.group_workout_exercises g where g.id = group_workout_exercise_sets.group_workout_exercise_id and is_group_coach(g.group_id)));

drop policy "recipes_write_own" on public.recipes;
create policy "recipes_insert_own" on public.recipes for insert to authenticated with check (created_by = (select auth.uid()));
create policy "recipes_update_own" on public.recipes for update to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy "recipes_delete_own" on public.recipes for delete to authenticated using (created_by = (select auth.uid()));

drop policy "recipe_ingredients_write_own" on public.recipe_ingredients;
create policy "recipe_ingredients_insert_own" on public.recipe_ingredients for insert
  to authenticated with check (exists (select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id and r.created_by = (select auth.uid())));
create policy "recipe_ingredients_update_own" on public.recipe_ingredients for update
  to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id and r.created_by = (select auth.uid())))
  with check (exists (select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id and r.created_by = (select auth.uid())));
create policy "recipe_ingredients_delete_own" on public.recipe_ingredients for delete
  to authenticated using (exists (select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id and r.created_by = (select auth.uid())));

drop policy "wearable_connections_own" on public.wearable_connections;
create policy "wearable_connections_insert_own" on public.wearable_connections for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "wearable_connections_update_own" on public.wearable_connections for update to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "wearable_connections_delete_own" on public.wearable_connections for delete to authenticated using (profile_id = (select auth.uid()));

drop policy "org_memberships_manage_owner" on public.organization_memberships;
create policy "org_memberships_insert_owner" on public.organization_memberships for insert
  to authenticated with check (exists (select 1 from public.organizations o where o.id = organization_memberships.organization_id and o.owner_id = (select auth.uid())));
create policy "org_memberships_update_owner" on public.organization_memberships for update
  to authenticated
  using (exists (select 1 from public.organizations o where o.id = organization_memberships.organization_id and o.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.organizations o where o.id = organization_memberships.organization_id and o.owner_id = (select auth.uid())));
create policy "org_memberships_delete_owner" on public.organization_memberships for delete
  to authenticated using (exists (select 1 from public.organizations o where o.id = organization_memberships.organization_id and o.owner_id = (select auth.uid())));

drop policy "session_exercises_write_own_or_coach" on public.session_exercises;
create policy "session_exercises_insert_own_or_coach" on public.session_exercises for insert
  to authenticated with check (exists (select 1 from public.athlete_sessions s where s.id = session_exercises.session_id and ((s.athlete_id = (select auth.uid())) or is_group_coach(s.group_id))));
create policy "session_exercises_update_own_or_coach" on public.session_exercises for update
  to authenticated
  using (exists (select 1 from public.athlete_sessions s where s.id = session_exercises.session_id and ((s.athlete_id = (select auth.uid())) or is_group_coach(s.group_id))))
  with check (exists (select 1 from public.athlete_sessions s where s.id = session_exercises.session_id and ((s.athlete_id = (select auth.uid())) or is_group_coach(s.group_id))));
create policy "session_exercises_delete_own_or_coach" on public.session_exercises for delete
  to authenticated using (exists (select 1 from public.athlete_sessions s where s.id = session_exercises.session_id and ((s.athlete_id = (select auth.uid())) or is_group_coach(s.group_id))));

drop policy "set_logs_write_own_or_coach" on public.set_logs;
create policy "set_logs_insert_own_or_coach" on public.set_logs for insert
  to authenticated with check (exists (select 1 from public.session_exercises se join public.athlete_sessions s on s.id = se.session_id where se.id = set_logs.session_exercise_id and ((s.athlete_id = (select auth.uid())) or is_group_coach(s.group_id))));
create policy "set_logs_update_own_or_coach" on public.set_logs for update
  to authenticated
  using (exists (select 1 from public.session_exercises se join public.athlete_sessions s on s.id = se.session_id where se.id = set_logs.session_exercise_id and ((s.athlete_id = (select auth.uid())) or is_group_coach(s.group_id))))
  with check (exists (select 1 from public.session_exercises se join public.athlete_sessions s on s.id = se.session_id where se.id = set_logs.session_exercise_id and ((s.athlete_id = (select auth.uid())) or is_group_coach(s.group_id))));
create policy "set_logs_delete_own_or_coach" on public.set_logs for delete
  to authenticated using (exists (select 1 from public.session_exercises se join public.athlete_sessions s on s.id = se.session_id where se.id = set_logs.session_exercise_id and ((s.athlete_id = (select auth.uid())) or is_group_coach(s.group_id))));

-- ============================================================
-- (b) SELECT does NOT self-cover — merge, then split ALL
-- ============================================================

drop policy "client_habits_coach_manage" on public.client_habits;
drop policy "client_habits_athlete_select" on public.client_habits;
create policy "client_habits_select_own_or_coach" on public.client_habits for select
  to authenticated using ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "client_habits_insert_coach" on public.client_habits for insert to authenticated with check (is_group_coach(group_id));
create policy "client_habits_update_coach" on public.client_habits for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "client_habits_delete_coach" on public.client_habits for delete to authenticated using (is_group_coach(group_id));

drop policy "daily_macros_coach_manage" on public.daily_macros;
drop policy "daily_macros_athlete_select" on public.daily_macros;
create policy "daily_macros_select_own_or_coach" on public.daily_macros for select
  to authenticated using ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "daily_macros_insert_coach" on public.daily_macros for insert to authenticated with check (is_group_coach(group_id));
create policy "daily_macros_update_coach" on public.daily_macros for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "daily_macros_delete_coach" on public.daily_macros for delete to authenticated using (is_group_coach(group_id));

drop policy "credits_coach_manage" on public.session_credits;
drop policy "credits_athlete_select" on public.session_credits;
create policy "credits_select_own_or_coach" on public.session_credits for select
  to authenticated using ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "credits_insert_coach" on public.session_credits for insert to authenticated with check (is_group_coach(group_id));
create policy "credits_update_own_or_coach" on public.session_credits for update
  to authenticated using ((athlete_id = (select auth.uid())) or is_group_coach(group_id)) with check ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "credits_delete_coach" on public.session_credits for delete to authenticated using (is_group_coach(group_id));

drop policy "workout_assignments_coach_manage" on public.workout_assignments;
drop policy "workout_assignments_athlete_select" on public.workout_assignments;
create policy "workout_assignments_select_own_or_coach" on public.workout_assignments for select
  to authenticated using ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "workout_assignments_insert_coach" on public.workout_assignments for insert to authenticated with check (is_group_coach(group_id));
create policy "workout_assignments_update_coach" on public.workout_assignments for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "workout_assignments_delete_coach" on public.workout_assignments for delete to authenticated using (is_group_coach(group_id));

drop policy "package_assignments_coach_manage" on public.package_assignments;
drop policy "package_assignments_athlete_select" on public.package_assignments;
create policy "package_assignments_select_own_or_coach" on public.package_assignments for select
  to authenticated using ((athlete_id = (select auth.uid())) or is_coach_of_package(coach_package_id));
create policy "package_assignments_insert_coach" on public.package_assignments for insert to authenticated with check (is_coach_of_package(coach_package_id));
create policy "package_assignments_update_coach" on public.package_assignments for update to authenticated using (is_coach_of_package(coach_package_id)) with check (is_coach_of_package(coach_package_id));
create policy "package_assignments_delete_coach" on public.package_assignments for delete to authenticated using (is_coach_of_package(coach_package_id));

drop policy "meal_plans_coach_manage" on public.meal_plans;
drop policy "meal_plans_athlete_select_own" on public.meal_plans;
create policy "meal_plans_select_own_or_coach" on public.meal_plans for select
  to authenticated using ((athlete_id = (select auth.uid())) or is_group_coach(group_id));
create policy "meal_plans_insert_coach" on public.meal_plans for insert to authenticated with check (is_group_coach(group_id));
create policy "meal_plans_update_coach" on public.meal_plans for update to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));
create policy "meal_plans_delete_coach" on public.meal_plans for delete to authenticated using (is_group_coach(group_id));

drop policy "push_subscriptions_own" on public.push_subscriptions;
drop policy "push_subscriptions_select_coach" on public.push_subscriptions;
create policy "push_subscriptions_select_own_or_coach" on public.push_subscriptions for select
  to authenticated using (
    (profile_id = (select auth.uid()))
    or exists (
      select 1 from public.group_memberships gm_coach
      join public.group_memberships gm_athlete on gm_athlete.group_id = gm_coach.group_id
      where gm_coach.profile_id = (select auth.uid()) and gm_coach.role = 'coach'
        and gm_athlete.profile_id = push_subscriptions.profile_id and gm_athlete.role = 'athlete'
    )
  );
create policy "push_subscriptions_insert_own" on public.push_subscriptions for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "push_subscriptions_update_own" on public.push_subscriptions for update to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "push_subscriptions_delete_own" on public.push_subscriptions for delete to authenticated using (profile_id = (select auth.uid()));

drop policy "challenges_coach_manage" on public.challenges;
drop policy "challenges_client_select" on public.challenges;
create policy "challenges_select_own_or_client" on public.challenges for select
  to authenticated using ((coach_id = (select auth.uid())) or (status <> 'draft' and is_client_of_coach(coach_id)));
create policy "challenges_insert_coach" on public.challenges for insert to authenticated with check (coach_id = (select auth.uid()));
create policy "challenges_update_coach" on public.challenges for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "challenges_delete_coach" on public.challenges for delete to authenticated using (coach_id = (select auth.uid()));

drop policy "availability_exceptions_coach_manage" on public.coach_availability_exceptions;
drop policy "availability_exceptions_client_select" on public.coach_availability_exceptions;
create policy "availability_exceptions_select_own_or_client" on public.coach_availability_exceptions for select
  to authenticated using ((coach_id = (select auth.uid())) or is_client_of_coach(coach_id));
create policy "availability_exceptions_insert_coach" on public.coach_availability_exceptions for insert to authenticated with check (coach_id = (select auth.uid()));
create policy "availability_exceptions_update_coach" on public.coach_availability_exceptions for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "availability_exceptions_delete_coach" on public.coach_availability_exceptions for delete to authenticated using (coach_id = (select auth.uid()));

drop policy "availability_coach_manage" on public.coach_availability_windows;
drop policy "availability_client_select" on public.coach_availability_windows;
create policy "availability_select_own_or_client" on public.coach_availability_windows for select
  to authenticated using ((coach_id = (select auth.uid())) or is_client_of_coach(coach_id));
create policy "availability_insert_coach" on public.coach_availability_windows for insert to authenticated with check (coach_id = (select auth.uid()));
create policy "availability_update_coach" on public.coach_availability_windows for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "availability_delete_coach" on public.coach_availability_windows for delete to authenticated using (coach_id = (select auth.uid()));

drop policy "booking_policies_coach_manage" on public.coach_booking_policies;
drop policy "booking_policies_client_select" on public.coach_booking_policies;
create policy "booking_policies_select_own_or_client" on public.coach_booking_policies for select
  to authenticated using ((coach_id = (select auth.uid())) or is_client_of_coach(coach_id));
create policy "booking_policies_insert_coach" on public.coach_booking_policies for insert to authenticated with check (coach_id = (select auth.uid()));
create policy "booking_policies_update_coach" on public.coach_booking_policies for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "booking_policies_delete_coach" on public.coach_booking_policies for delete to authenticated using (coach_id = (select auth.uid()));

drop policy "coach_packages_coach_manage" on public.coach_packages;
drop policy "coach_packages_client_select" on public.coach_packages;
create policy "coach_packages_select_own_or_client" on public.coach_packages for select
  to authenticated using (
    (coach_id = (select auth.uid()))
    or (is_active and is_client_of_coach(coach_id) and (is_public or is_package_assigned_to_viewer(id)))
  );
create policy "coach_packages_insert_coach" on public.coach_packages for insert to authenticated with check (coach_id = (select auth.uid()));
create policy "coach_packages_update_coach" on public.coach_packages for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "coach_packages_delete_coach" on public.coach_packages for delete to authenticated using (coach_id = (select auth.uid()));

drop policy "pro_shop_links_coach_manage" on public.pro_shop_links;
drop policy "pro_shop_links_client_select" on public.pro_shop_links;
create policy "pro_shop_links_select_own_or_client" on public.pro_shop_links for select
  to authenticated using ((coach_id = (select auth.uid())) or is_client_of_coach(coach_id));
create policy "pro_shop_links_insert_coach" on public.pro_shop_links for insert to authenticated with check (coach_id = (select auth.uid()));
create policy "pro_shop_links_update_coach" on public.pro_shop_links for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "pro_shop_links_delete_coach" on public.pro_shop_links for delete to authenticated using (coach_id = (select auth.uid()));

drop policy "referral_partners_coach_manage" on public.referral_partners;
drop policy "referral_partners_client_select" on public.referral_partners;
create policy "referral_partners_select_own_or_client" on public.referral_partners for select
  to authenticated using ((coach_id = (select auth.uid())) or is_client_of_coach(coach_id));
create policy "referral_partners_insert_coach" on public.referral_partners for insert to authenticated with check (coach_id = (select auth.uid()));
create policy "referral_partners_update_coach" on public.referral_partners for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "referral_partners_delete_coach" on public.referral_partners for delete to authenticated using (coach_id = (select auth.uid()));

-- ============================================================
-- Special case: organizations — two SELECT-only policies, no ALL
-- policy involved at all. Just merge the two selects into one.
-- ============================================================

drop policy "organizations_select_member" on public.organizations;
drop policy "organizations_select_platform_admin" on public.organizations;
create policy "organizations_select_member_or_platform_admin" on public.organizations for select
  to authenticated using (
    is_org_member(id)
    or exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.is_platform_admin)
  );

-- ============================================================
-- Special case: challenge_participants — SELECT already self-covers
-- (untouched); INSERT and UPDATE each need the coach's condition merged
-- into the existing dedicated policy; DELETE had no policy of its own
-- at all (only the ALL policy covered it), so it needs a new one.
-- ============================================================

drop policy "challenge_participants_coach_manage" on public.challenge_participants;

drop policy "challenge_participants_self_join" on public.challenge_participants;
create policy "challenge_participants_insert_self_or_coach" on public.challenge_participants for insert
  to authenticated with check (
    ((profile_id = (select auth.uid())) and exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.status = 'active' and is_client_of_coach(c.coach_id)))
    or exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.coach_id = (select auth.uid()))
  );

drop policy "challenge_participants_update_own" on public.challenge_participants;
create policy "challenge_participants_update_own_or_coach" on public.challenge_participants for update
  to authenticated
  using ((profile_id = (select auth.uid())) or exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.coach_id = (select auth.uid())))
  with check ((profile_id = (select auth.uid())) or exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.coach_id = (select auth.uid())));

create policy "challenge_participants_delete_coach" on public.challenge_participants for delete
  to authenticated using (exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.coach_id = (select auth.uid())));
