-- Performance-only cleanup flagged by the Supabase advisor — zero access
-- changes, every predicate below is logically identical to what it
-- replaces. Two categories:
--
-- 1) auth_rls_initplan: a bare `auth.uid()` inside an RLS policy gets
--    re-evaluated once per row instead of once per query. Wrapping it as
--    `(select auth.uid())` lets Postgres cache it as an InitPlan — same
--    predicate, evaluated once. Same pattern already used everywhere else
--    in this schema; these 13 policies were the stragglers.
-- 2) multiple_permissive_policies (partial): where a table only has a
--    trivial `true`/own-row SELECT policy plus a separate coach/owner
--    `FOR ALL` policy, the ALL policy is split into INSERT/UPDATE/DELETE
--    so SELECT only ever matches one policy — same write behavior,
--    unchanged, just no longer redundantly evaluated on every read.
--    The remaining ~30 multiple-permissive-policy findings involve real
--    per-row OR logic (coach vs. athlete vs. org-admin) and are left for
--    a dedicated, carefully-reviewed pass rather than a blind mechanical
--    rewrite of that many access-control predicates in one go.

-- ---- auth_rls_initplan ----

drop policy "organizations_insert_platform_admin" on public.organizations;
create policy "organizations_insert_platform_admin" on public.organizations for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.is_platform_admin)
  );

drop policy "organizations_select_platform_admin" on public.organizations;
create policy "organizations_select_platform_admin" on public.organizations for select
  to authenticated
  using (exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.is_platform_admin));

drop policy "pro_shop_links_coach_manage" on public.pro_shop_links;
create policy "pro_shop_links_coach_manage" on public.pro_shop_links for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

drop policy "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert
  to authenticated
  with check (
    is_group_coach(group_id)
    or ((profile_id = (select auth.uid())) and role = 'athlete' and has_valid_group_invite(group_id))
    or ((profile_id = (select auth.uid())) and role = 'coach' and is_org_admin_of_group(group_id))
  );

drop policy "sessions_select_own_or_coach" on public.athlete_sessions;
create policy "sessions_select_own_or_coach" on public.athlete_sessions for select
  to authenticated
  using (
    (athlete_id = (select auth.uid()))
    or is_group_coach(group_id)
    or ((is_org_admin_of_group(group_id) or is_platform_admin()) and not is_client_private_from_org(group_id, athlete_id))
  );

drop policy "session_exercises_select_own_or_coach" on public.session_exercises;
create policy "session_exercises_select_own_or_coach" on public.session_exercises for select
  to authenticated
  using (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and (
          (s.athlete_id = (select auth.uid()))
          or is_group_coach(s.group_id)
          or ((is_org_admin_of_group(s.group_id) or is_platform_admin()) and not is_client_private_from_org(s.group_id, s.athlete_id))
        )
    )
  );

drop policy "set_logs_select_own_or_coach" on public.set_logs;
create policy "set_logs_select_own_or_coach" on public.set_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and (
          (s.athlete_id = (select auth.uid()))
          or is_group_coach(s.group_id)
          or ((is_org_admin_of_group(s.group_id) or is_platform_admin()) and not is_client_private_from_org(s.group_id, s.athlete_id))
        )
    )
  );

drop policy "gwe_select_members" on public.group_workout_exercises;
create policy "gwe_select_members" on public.group_workout_exercises for select
  to authenticated
  using (
    (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)))
    or ((is_org_admin_of_group(group_id) or is_platform_admin()) and (athlete_id is null or not is_client_private_from_org(group_id, athlete_id)))
  );

drop policy "gwes_select_members" on public.group_workout_exercise_sets;
create policy "gwes_select_members" on public.group_workout_exercise_sets for select
  to authenticated
  using (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_sets.group_workout_exercise_id
        and (
          (is_group_member(g.group_id) and (g.athlete_id is null or g.athlete_id = (select auth.uid()) or is_group_coach(g.group_id)))
          or ((is_org_admin_of_group(g.group_id) or is_platform_admin()) and (g.athlete_id is null or not is_client_private_from_org(g.group_id, g.athlete_id)))
        )
    )
  );

drop policy "discovery_bookings_coach_manage" on public.discovery_bookings;
create policy "discovery_bookings_coach_manage" on public.discovery_bookings for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

drop policy "wearable_connections_select_own_or_coach" on public.wearable_connections;
create policy "wearable_connections_select_own_or_coach" on public.wearable_connections for select
  to authenticated
  using (
    (profile_id = (select auth.uid()))
    or exists (
      select 1 from public.group_memberships gm_self
      join public.group_memberships gm_target on gm_target.group_id = gm_self.group_id
      where gm_self.profile_id = (select auth.uid()) and gm_self.role = 'coach' and gm_target.profile_id = wearable_connections.profile_id
    )
    or (
      not is_wearable_subject_private_from_org(profile_id)
      and (
        exists (
          select 1 from public.group_memberships gm_target
          join public.groups g on g.id = gm_target.group_id
          join public.organization_memberships om on om.organization_id = g.organization_id
          where gm_target.profile_id = wearable_connections.profile_id
            and om.profile_id = (select auth.uid())
            and om.role in ('owner', 'admin')
        )
        or is_platform_admin()
      )
    )
  );

drop policy "wearable_daily_metrics_select_own_or_coach" on public.wearable_daily_metrics;
create policy "wearable_daily_metrics_select_own_or_coach" on public.wearable_daily_metrics for select
  to authenticated
  using (
    exists (
      select 1 from public.wearable_connections c
      where c.id = wearable_daily_metrics.connection_id
        and (
          (c.profile_id = (select auth.uid()))
          or exists (
            select 1 from public.group_memberships gm_self
            join public.group_memberships gm_target on gm_target.group_id = gm_self.group_id
            where gm_self.profile_id = (select auth.uid()) and gm_self.role = 'coach' and gm_target.profile_id = c.profile_id
          )
          or (
            not is_wearable_subject_private_from_org(c.profile_id)
            and (
              exists (
                select 1 from public.group_memberships gm_target
                join public.groups g on g.id = gm_target.group_id
                join public.organization_memberships om on om.organization_id = g.organization_id
                where gm_target.profile_id = c.profile_id
                  and om.profile_id = (select auth.uid())
                  and om.role in ('owner', 'admin')
              )
              or is_platform_admin()
            )
          )
        )
    )
  );

drop policy "posts_delete_own_or_coach" on public.posts;
create policy "posts_delete_own_or_coach" on public.posts for delete
  to authenticated
  using (
    (author_id = (select auth.uid()))
    or is_group_coach(group_id)
    or is_org_admin_of_group(group_id)
    or is_platform_admin()
  );

-- ---- multiple_permissive_policies (trivial cases only) ----
-- Each of these three tables has an unconditional `true` SELECT policy
-- alongside a separate owner-only FOR ALL policy — splitting the ALL
-- policy into insert/update/delete removes the redundant double
-- evaluation on every read, with the exact same write behavior.

drop policy "movement_patterns_write_own" on public.movement_patterns;
create policy "movement_patterns_insert_own" on public.movement_patterns for insert
  to authenticated with check (created_by = (select auth.uid()));
create policy "movement_patterns_update_own" on public.movement_patterns for update
  to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy "movement_patterns_delete_own" on public.movement_patterns for delete
  to authenticated using (created_by = (select auth.uid()));

drop policy "movement_pattern_exercises_write_own" on public.movement_pattern_exercises;
create policy "movement_pattern_exercises_insert_own" on public.movement_pattern_exercises for insert
  to authenticated with check (
    exists (select 1 from public.movement_patterns mp where mp.id = movement_pattern_exercises.movement_pattern_id and mp.created_by = (select auth.uid()))
  );
create policy "movement_pattern_exercises_update_own" on public.movement_pattern_exercises for update
  to authenticated
  using (exists (select 1 from public.movement_patterns mp where mp.id = movement_pattern_exercises.movement_pattern_id and mp.created_by = (select auth.uid())))
  with check (exists (select 1 from public.movement_patterns mp where mp.id = movement_pattern_exercises.movement_pattern_id and mp.created_by = (select auth.uid())));
create policy "movement_pattern_exercises_delete_own" on public.movement_pattern_exercises for delete
  to authenticated using (
    exists (select 1 from public.movement_patterns mp where mp.id = movement_pattern_exercises.movement_pattern_id and mp.created_by = (select auth.uid()))
  );

drop policy "recipe_votes_write_own" on public.recipe_votes;
create policy "recipe_votes_insert_own" on public.recipe_votes for insert
  to authenticated with check (profile_id = (select auth.uid()));
create policy "recipe_votes_update_own" on public.recipe_votes for update
  to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "recipe_votes_delete_own" on public.recipe_votes for delete
  to authenticated using (profile_id = (select auth.uid()));

-- ---- unindexed foreign keys ----

create index if not exists pro_shop_links_coach_id_idx on public.pro_shop_links(coach_id);
create index if not exists subscription_credit_grants_athlete_id_idx on public.subscription_credit_grants(athlete_id);
create index if not exists subscription_credit_grants_coach_package_id_idx on public.subscription_credit_grants(coach_package_id);
create index if not exists subscription_credit_grants_group_id_idx on public.subscription_credit_grants(group_id);
