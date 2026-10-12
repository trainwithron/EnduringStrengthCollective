-- RELEASE AW (THE ORGANIZATION WALLS: NAMES AND CLIENT CONTENT READABLE ONLY INSIDE THE ORGANIZATION; RUN AFTER THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 91 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 91: Names: a coach sees their own clients and the owner or admins of their organization, a client sees their coach, the owner and their team, the owner of an organization sees everyone in it, and nobody sees a person from another organization. Old records of a client who left a group still show their name to the coach who had them. The platform administrator account no longer reads workout sessions, sets, program exercises, feed posts or wearable data of organizations it is not in. Nothing is deleted. Run this AFTER the code that goes with it is live (the code never relies on seeing a stranger's name).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AW (the organization walls: names and client content readable only inside the organization; run AFTER the code that goes with it is live), step 91: 0345 The organization walls: a person can only see names of people they share a group with (or, for an owner or admin, everyone in their organization); a platform administrator can no longer read client content; who has which tag is limited to the owner, admins and that client's coach
do $g91$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0345 is not already applied (the open profiles rule is still there)', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_authenticated')),
      ('the helpers the new rules use exist', to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null and to_regprocedure('public.is_client_private_from_org(uuid, uuid)') is not null and to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.is_workout_visible_to_athlete(uuid)') is not null),
      ('the tables the new rules read exist', to_regclass('public.training_partner_profiles') is not null and to_regclass('public.training_partner_requests') is not null and to_regclass('public.session_credits') is not null and to_regclass('public.client_tag_assignments') is not null and to_regclass('public.wearable_connections') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AW (the organization walls: names and client content readable only inside the organization; run AFTER the code that goes with it is live), step 91 (0345) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g91$;

-- ====================================================================================================
-- migration 0345_organization_walls.sql
-- ====================================================================================================

-- Release AW: the organization walls, in the database.
-- Ron's rule: INSIDE an organization the OWNER (and an admin, who is no wider than the owner) sees everything in it; a COACH sees only their own clients and their own data; a CLIENT sees themself, their
-- own coach(es) and, inside a team or social group they belong to, that group's members; NOBODY sees anything in another organization. A platform administrator is not a way around this: the
-- ONLY way to see an organization is to own it (or be its admin) or to be in it.
--
-- 1. Who can read whom (profiles). Before, every signed-in account could read every profile (name, photo, time zone, the platform-admin flag). Now a profile is readable by: the person themself;
--    anyone who shares a group with them (a coach and their clients, a client and their coach and teammates); an owner or admin of an organization, for everyone in that organization's groups;
--    people in an organization, for that organization's owner and admins; a coach for someone who has a booking or a session balance with them in a group they coach (so a client who has since
--    left still shows their name in the coach's old records); and the people the training-partner matching already lets them see (those rules check themselves). The platform administrator sees staff names only (owners, admins, coaches: needed for the support, feedback and organizations screens), never a client.
-- 2. The platform-admin read of CONTENT is removed: workout sessions, sets, program exercises, feed posts (read and delete), briefing items and wearable data no longer have an "or platform admin"
--    branch. (Support, audit, feedback, cron and billing-flag screens for running the service are not client content and keep theirs.)
-- 3. Tags: who has which tag is visible to the organization's owner and admins and to the coach of that client, not to every coach of the organization.
-- Existing rows are untouched. The server (service role) is unaffected.

-- Training-partner matching ACROSS organizations is switched off (Ron, Oct 12): partners match only inside one organization. Turning it back on is replacing this one function with "select true".
create or replace function public.training_partners_cross_org_enabled()
returns boolean
language sql
immutable
as $$ select false; $$;
grant execute on function public.training_partners_cross_org_enabled() to authenticated, service_role;

drop policy if exists "training_partner_profiles_select_visible" on public.training_partner_profiles;
create policy "training_partner_profiles_select_visible" on public.training_partner_profiles for select
  to authenticated using (
    visible = true
    and not public.training_partners_mutually_blocked(athlete_id, (select auth.uid()))
    and (
      public.training_partners_share_org(athlete_id, (select auth.uid()))
      or (public.training_partners_cross_org_enabled() and not public.training_partner_is_restricted(athlete_id) and not public.training_partner_is_restricted((select auth.uid())))
    )
  );

drop policy if exists "training_partner_requests_insert_own" on public.training_partner_requests;
create policy "training_partner_requests_insert_own" on public.training_partner_requests for insert
  to authenticated with check (
    from_athlete_id = (select auth.uid())
    and not public.training_partners_mutually_blocked(to_athlete_id, (select auth.uid()))
    and (
      public.training_partners_share_org(to_athlete_id, (select auth.uid()))
      or (public.training_partners_cross_org_enabled() and not public.training_partner_is_restricted(to_athlete_id) and not public.training_partner_is_restricted((select auth.uid())))
    )
  );

create or replace function public.can_see_profile(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_target
    -- shares a group (a coach and their clients; a client with their coach and teammates)
    or exists (
      select 1 from public.group_memberships mine
      join public.group_memberships theirs on theirs.group_id = mine.group_id
      where mine.profile_id = (select auth.uid()) and theirs.profile_id = p_target
    )
    -- an owner or admin of an organization sees the people in its groups
    or exists (
      select 1 from public.organization_memberships om
      join public.groups g on g.organization_id = om.organization_id
      join public.group_memberships gm on gm.group_id = g.id
      where om.profile_id = (select auth.uid()) and om.role in ('owner', 'admin') and gm.profile_id = p_target
        -- a client who is private from the organization is not listed to its owner or admins either
        and not public.is_client_private_from_org(gm.group_id, gm.profile_id)
    )
    -- an owner or admin also sees the owner, admins and coaches of their own organization (staff who are not in any group)
    or exists (
      select 1 from public.organization_memberships me
      join public.organization_memberships them on them.organization_id = me.organization_id
      where me.profile_id = (select auth.uid()) and me.role in ('owner', 'admin') and them.profile_id = p_target
    )
    -- people in an organization see its owner and admins
    or exists (
      select 1 from public.organization_memberships om
      join public.groups g on g.organization_id = om.organization_id
      join public.group_memberships gm on gm.group_id = g.id
      where om.profile_id = p_target and om.role in ('owner', 'admin') and gm.profile_id = (select auth.uid())
    )
    -- a coach sees someone with a session balance or a booking in a group they coach (a client who has since left)
    or exists (
      select 1 from public.session_credits sc
      join public.group_memberships c on c.group_id = sc.group_id and c.profile_id = (select auth.uid()) and c.role = 'coach'
      where sc.athlete_id = p_target
    )
    or exists (select 1 from public.bookings b where b.coach_id = (select auth.uid()) and b.athlete_id = p_target)
    -- the platform administrator runs the service (support, feedback, organizations): staff names only (owners, admins, coaches), never a client
    or (public.is_platform_admin() and exists (select 1 from public.organization_memberships sm where sm.profile_id = p_target))
    -- the author of a post or comment in a group the viewer is in (someone who has since left the group still shows their name on what they wrote)
    or exists (select 1 from public.posts po where po.author_id = p_target and public.is_group_member(po.group_id))
    or exists (select 1 from public.comments co where co.author_id = p_target and public.is_group_member(co.group_id))
    -- training-partner matching, with the matching feature's OWN rules (this function bypasses row security, so they are repeated here): a visible partner profile who is not blocked and whom
    -- the viewer is allowed to match with; and a partner request that involves the viewer
    or exists (
      select 1 from public.training_partner_profiles tp
      where tp.athlete_id = p_target and tp.visible = true
        and not public.training_partners_mutually_blocked(p_target, (select auth.uid()))
        and (
          public.training_partners_share_org(p_target, (select auth.uid()))
          or (public.training_partners_cross_org_enabled() and not public.training_partner_is_restricted(p_target) and not public.training_partner_is_restricted((select auth.uid())))
        )
    )
    or exists (
      select 1 from public.training_partner_requests r
      where (r.from_athlete_id = (select auth.uid()) and r.to_athlete_id = p_target) or (r.to_athlete_id = (select auth.uid()) and r.from_athlete_id = p_target)
    );
$$;
revoke execute on function public.can_see_profile(uuid) from public, anon;
grant execute on function public.can_see_profile(uuid) to authenticated, service_role;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_visible" on public.profiles for select
  to authenticated using (public.can_see_profile(id));

-- 2. No platform-admin read of client content.
drop policy if exists "sessions_select_own_or_coach" on public.athlete_sessions;
create policy "sessions_select_own_or_coach" on public.athlete_sessions for select
  to authenticated using (
    athlete_id = (select auth.uid())
    or public.is_group_coach(group_id)
    or (public.is_org_admin_of_group(group_id) and not public.is_client_private_from_org(group_id, athlete_id))
  );

drop policy if exists "coach_briefing_items_select_assigned_or_cascade" on public.coach_briefing_items;
create policy "coach_briefing_items_select_assigned_or_cascade" on public.coach_briefing_items for select
  to authenticated using (
    public.is_group_coach(group_id)
    or (not public.is_client_private_from_org(group_id, athlete_id) and public.is_org_admin_of_group(group_id))
  );

drop policy if exists "gwes_select_members" on public.group_workout_exercise_sets;
create policy "gwes_select_members" on public.group_workout_exercise_sets for select
  to authenticated using (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_sets.group_workout_exercise_id
        and (
          (public.is_group_member(g.group_id)
            and (g.athlete_id is null or g.athlete_id = (select auth.uid()) or public.is_group_coach(g.group_id))
            and (public.is_group_coach(g.group_id) or public.is_workout_visible_to_athlete(g.workout_id)))
          or (public.is_org_admin_of_group(g.group_id) and (g.athlete_id is null or not public.is_client_private_from_org(g.group_id, g.athlete_id)))
        )
    )
  );

drop policy if exists "gwe_select_members" on public.group_workout_exercises;
create policy "gwe_select_members" on public.group_workout_exercises for select
  to authenticated using (
    (public.is_group_member(group_id)
      and (athlete_id is null or athlete_id = (select auth.uid()) or public.is_group_coach(group_id))
      and (public.is_group_coach(group_id) or public.is_workout_visible_to_athlete(workout_id)))
    or (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)))
  );

drop policy if exists "posts_select_members" on public.posts;
create policy "posts_select_members" on public.posts for select
  to authenticated using (public.is_group_member(group_id) or public.is_org_admin_of_group(group_id));

drop policy if exists "posts_delete_own_or_coach" on public.posts;
create policy "posts_delete_own_or_coach" on public.posts for delete
  to authenticated using (author_id = (select auth.uid()) or public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));

drop policy if exists "session_exercises_select_own_or_coach" on public.session_exercises;
create policy "session_exercises_select_own_or_coach" on public.session_exercises for select
  to authenticated using (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and (
          s.athlete_id = (select auth.uid())
          or public.is_group_coach(s.group_id)
          or (public.is_org_admin_of_group(s.group_id) and not public.is_client_private_from_org(s.group_id, s.athlete_id))
        )
    )
  );

drop policy if exists "set_logs_select_own_or_coach" on public.set_logs;
create policy "set_logs_select_own_or_coach" on public.set_logs for select
  to authenticated using (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and (
          s.athlete_id = (select auth.uid())
          or public.is_group_coach(s.group_id)
          or (public.is_org_admin_of_group(s.group_id) and not public.is_client_private_from_org(s.group_id, s.athlete_id))
        )
    )
  );

drop policy if exists "wearable_connections_select_own_or_coach" on public.wearable_connections;
create policy "wearable_connections_select_own_or_coach" on public.wearable_connections for select
  to authenticated using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.group_memberships gm_self
      join public.group_memberships gm_target on gm_target.group_id = gm_self.group_id
      where gm_self.profile_id = (select auth.uid()) and gm_self.role = 'coach' and gm_target.profile_id = wearable_connections.profile_id
    )
    or (
      not public.is_wearable_subject_private_from_org(profile_id)
      and exists (
        select 1 from public.group_memberships gm_target
        join public.groups g on g.id = gm_target.group_id
        join public.organization_memberships om on om.organization_id = g.organization_id
        where gm_target.profile_id = wearable_connections.profile_id and om.profile_id = (select auth.uid()) and om.role in ('owner', 'admin')
      )
    )
  );

drop policy if exists "wearable_daily_metrics_select_own_or_coach" on public.wearable_daily_metrics;
create policy "wearable_daily_metrics_select_own_or_coach" on public.wearable_daily_metrics for select
  to authenticated using (
    exists (
      select 1 from public.wearable_connections c
      where c.id = wearable_daily_metrics.connection_id
        and (
          c.profile_id = (select auth.uid())
          or exists (
            select 1 from public.group_memberships gm_self
            join public.group_memberships gm_target on gm_target.group_id = gm_self.group_id
            where gm_self.profile_id = (select auth.uid()) and gm_self.role = 'coach' and gm_target.profile_id = c.profile_id
          )
          or (
            not public.is_wearable_subject_private_from_org(c.profile_id)
            and exists (
              select 1 from public.group_memberships gm_target
              join public.groups g on g.id = gm_target.group_id
              join public.organization_memberships om on om.organization_id = g.organization_id
              where gm_target.profile_id = c.profile_id and om.profile_id = (select auth.uid()) and om.role in ('owner', 'admin')
            )
          )
        )
    )
  );

-- 2b. The organization's owner and admins (no wider than the owner) can READ its business tables: programs, packages, bookings, session balances and the ledger, payments, subscriptions, logged workouts.
-- A client who is private from the organization stays private. Nothing about this reaches another organization, and a coach still sees only their own groups.
drop policy if exists "programs_select_org_owner" on public.programs;
create policy "programs_select_org_owner" on public.programs for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "workouts_select_org_owner" on public.workouts;
create policy "workouts_select_org_owner" on public.workouts for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "coach_packages_select_org_owner" on public.coach_packages;
create policy "coach_packages_select_org_owner" on public.coach_packages for select
  to authenticated using (public.is_org_admin_of_group(group_id));
drop policy if exists "bookings_select_org_owner" on public.bookings;
create policy "bookings_select_org_owner" on public.bookings for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "session_credits_select_org_owner" on public.session_credits;
create policy "session_credits_select_org_owner" on public.session_credits for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "session_credit_ledger_select_org_owner" on public.session_credit_ledger;
create policy "session_credit_ledger_select_org_owner" on public.session_credit_ledger for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "credit_purchases_select_org_owner" on public.credit_purchases;
create policy "credit_purchases_select_org_owner" on public.credit_purchases for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "membership_subscriptions_select_org_owner" on public.membership_subscriptions;
create policy "membership_subscriptions_select_org_owner" on public.membership_subscriptions for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "coach_quick_payments_select_org_owner" on public.coach_quick_payments;
create policy "coach_quick_payments_select_org_owner" on public.coach_quick_payments for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "workout_logs_select_org_owner" on public.workout_logs;
create policy "workout_logs_select_org_owner" on public.workout_logs for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "group_memberships_select_org_owner" on public.group_memberships;
create policy "group_memberships_select_org_owner" on public.group_memberships for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (role <> 'athlete' or not public.is_client_private_from_org(group_id, profile_id)));

-- 2c. ...and, per Ron ("the owner sees everything in the organization because they own it"), the organization's own clients' messages, coach notes, intake forms and nutrition records. Read only, never a
-- client who is private from the organization. NOT widened: a coach's own AI conversations and learned rules, and the per-exercise session notes a coach keeps (session_exercise_coach_notes: they have
-- no client column to apply the private-from-organization rule to, so they stay the coach's own working notes).
drop policy if exists "athlete_notes_select_org_owner" on public.athlete_notes;
create policy "athlete_notes_select_org_owner" on public.athlete_notes for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "client_intake_select_org_owner" on public.client_intake;
create policy "client_intake_select_org_owner" on public.client_intake for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "daily_macros_select_org_owner" on public.daily_macros;
create policy "daily_macros_select_org_owner" on public.daily_macros for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "meal_plans_select_org_owner" on public.meal_plans;
create policy "meal_plans_select_org_owner" on public.meal_plans for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "food_log_entries_select_org_owner" on public.food_log_entries;
create policy "food_log_entries_select_org_owner" on public.food_log_entries for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "client_macro_targets_select_org_owner" on public.client_macro_targets;
create policy "client_macro_targets_select_org_owner" on public.client_macro_targets for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "client_macro_target_history_select_org_owner" on public.client_macro_target_history;
create policy "client_macro_target_history_select_org_owner" on public.client_macro_target_history for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "nutrition_checkins_select_org_owner" on public.nutrition_checkins;
create policy "nutrition_checkins_select_org_owner" on public.nutrition_checkins for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "nutrition_phases_select_org_owner" on public.nutrition_phases;
create policy "nutrition_phases_select_org_owner" on public.nutrition_phases for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "client_phase_plans_select_org_owner" on public.client_phase_plans;
create policy "client_phase_plans_select_org_owner" on public.client_phase_plans for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "nutrition_checkin_suggestions_select_org_owner" on public.nutrition_checkin_suggestions;
create policy "nutrition_checkin_suggestions_select_org_owner" on public.nutrition_checkin_suggestions for select
  to authenticated using (public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
drop policy if exists "direct_messages_select_org_owner" on public.direct_messages;
create policy "direct_messages_select_org_owner" on public.direct_messages for select
  to authenticated using (public.is_org_admin_of_group(group_id) and not public.is_client_private_from_org(group_id, sender_id) and not public.is_client_private_from_org(group_id, recipient_id));

-- 3. Who has which tag: the organization's owner and admins, or the coach of that client (not every coach of the organization).
drop policy if exists "client_tag_assignments_select_org_member" on public.client_tag_assignments;
create policy "client_tag_assignments_select_org_member" on public.client_tag_assignments for select
  to authenticated using (
    exists (
      select 1 from public.client_tags t
      where t.id = client_tag_assignments.tag_id
        and (
          public.is_org_owner_or_admin(t.organization_id)
          or exists (
            select 1 from public.group_memberships c
            join public.group_memberships a on a.group_id = c.group_id
            where c.profile_id = (select auth.uid()) and c.role = 'coach' and a.profile_id = client_tag_assignments.athlete_id
          )
        )
    )
  );

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 91 (0345)' as step, '0345 The organization walls: a person can only see names of people they share a group with' as what, not ((exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_authenticated'))) as in_place
) as result order by step;
