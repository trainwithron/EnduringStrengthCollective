-- RELEASE AZ (DEFENSE IN DEPTH FOR THE ORGANIZATION WALLS, INSTALLED SWITCHED OFF; RUN BEFORE THE CODE THAT SENDS THE HEADER): ONE paste. Steps 94 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 94: Nothing visible changes: the rule is installed but switched off, so every request behaves exactly as before. It adds one extra rule (named org_wall_header) to each table whose rows belong to a group, and three helper functions. Run it BEFORE the code that goes with it is live; step 95 switches it on.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AZ (defense in depth for the organization walls, installed switched off; run BEFORE the code that sends the header), step 94: 0348 Defense in depth for the organization walls, installed switched OFF: the database learns to refuse a row of a different organization than the workspace a request names (nothing changes until step 95)
do $g94$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0348 is not already applied (the workspace helper does not exist yet)', to_regprocedure('public.request_workspace_org()') is null),
      ('the group and organization tables the rule reads exist', to_regclass('public.groups') is not null and to_regclass('public.programs') is not null and to_regclass('public.bookings') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AZ (defense in depth for the organization walls, installed switched off; run BEFORE the code that sends the header), step 94 (0348) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g94$;

-- ====================================================================================================
-- migration 0348_org_wall_request_header.sql
-- ====================================================================================================

-- Release AZ: defense in depth for the organization walls. The app now tells the database which workspace a request is for (a request header, x-workspace-group, carrying the open workspace's group). With
-- the header present, every table whose rows belong to a group refuses to show or change a row of a DIFFERENT organization, even to a coach who is a coach in both. Without the header (or with a header
-- that is not a group id) nothing changes. This step INSTALLS the rule switched OFF (org_wall_header_enabled() returns false); Release BA switches it on, and switching it off again is one line.
-- A restrictive policy is ANDed with every existing rule, so it can only remove access, never add it. Not applied to group_memberships and group_invites (they are how the app lists the person's other
-- organizations, the chooser and the switcher), nor to the organization, group and profile tables themselves.
create or replace function public.org_wall_header_enabled()
returns boolean
language sql
stable
set search_path = public
as $$ select false $$;

-- The organization of the workspace a request names, or null (no header, a header that is not a group id, a group that does not exist, or the rule switched off).
create or replace function public.request_workspace_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select g.organization_id
  from (select (nullif(current_setting('request.headers', true), '')::json ->> 'x-workspace-group') as v) h
  join public.groups g
    on g.id = case when h.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then h.v::uuid end
  where public.org_wall_header_enabled()
$$;

-- True when no workspace is named, the row has no group, or the row's group is in the named workspace's organization.
create or replace function public.group_in_active_org(_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.request_workspace_org() is null
      or _group_id is null
      or exists (select 1 from public.groups g where g.id = _group_id and g.organization_id = public.request_workspace_org())
$$;
revoke execute on function public.org_wall_header_enabled() from public, anon;
revoke execute on function public.request_workspace_org() from public, anon;
revoke execute on function public.group_in_active_org(uuid) from public, anon;
grant execute on function public.org_wall_header_enabled() to authenticated, service_role;
grant execute on function public.request_workspace_org() to authenticated, service_role;
grant execute on function public.group_in_active_org(uuid) to authenticated, service_role;

do $$
declare
  t text;
  tables text[] := array[
    'athlete_exercise_overrides','athlete_injury_status','athlete_notes','athlete_sessions','body_weight_logs','booking_requests','booking_waitlist_entries','bookings','client_billing_rates','client_goals',
    'client_habits','client_inactive','client_inactive_events','client_intake','client_macro_target_history','client_macro_targets','client_nutrition_feedback','client_phase_plans','coach_briefing_items',
    'coach_packages','coach_quick_payments','coach_video_checkin_action_items','coach_video_checkins','coach_view_state','comments','credit_purchases','daily_macros','direct_messages',
    'exercise_progressions','exercise_records','exercise_video_comments','food_log_entries','game_score_entries','group_positions','group_session_attendees','group_sessions','group_stat_fields',
    'group_workout_exercises','guardian_links','kiosk_checkins','kiosk_pins','meal_plan_tries','meal_plans','membership_subscriptions','milestone_events','minor_consent','notifications',
    'nutrition_checkin_suggestions','nutrition_checkins','nutrition_phases','package_group_access','posts','pro_shop_link_day_pins','programs','progress_photos','reactions','recurring_booking_series',
    'rest_day_nudges','schedule_requests','session_coach_notes','session_credit_expirations','session_credit_ledger','session_credit_reinstatements','session_credits','session_exercise_coach_notes',
    'session_exercise_videos','session_pattern_checks','subscription_credit_grants','team_games','team_practice_schedules','transformation_cards','transformation_milestones','wellness_checkins',
    'workout_assignments','workout_logs','workout_notes','workouts'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "org_wall_header" on public.%I', t);
      execute format('create policy "org_wall_header" on public.%I as restrictive for all to authenticated using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id))', t);
    end if;
  end loop;
end
$$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 94 (0348)' as step, '0348 Defense in depth for the organization walls' as what, not ((to_regprocedure('public.request_workspace_org()') is null)) as in_place
) as result order by step;
