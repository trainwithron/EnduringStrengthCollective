-- RELEASE O FIX 2 (CLOSE THE TRIGGER FUNCTIONS; RUN ANY TIME AFTER STEP 52): ONE paste. Steps 53 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 53: Nothing visible changes: every notice, guard and calculation that runs when something is saved still runs (the right to run a trigger function is checked when the trigger is made, not when it fires). Then run check-function-acl.sql: every row must say ok = true (it now has a row for trigger functions).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release O fix 2 (close the trigger functions; run any time after step 52), step 53: 0308 Release O fix: every trigger function that signed-in users could run by default is closed to the public and signed-in users, like the other internal functions (46 functions; they can only ever run as triggers, and no trigger stops firing)
do $g53$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('the trigger functions exist (the database has its triggers)', exists (select 1 from pg_proc where proname = 'guard_post_columns' and pronamespace = 'public'::regnamespace)),
      ('0308 is not already applied (signed-in users can still run at least one of the trigger functions)', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and p.proname = any (array['audit_log_refuse_changes', 'audit_watch', 'backfill_placeholder_group_name', 'block_athlete_edits_to_completed_session', 'clear_client_goal_phase_on_insert', 'default_client_tier_for_one_on_one', 'enforce_one_on_one_athlete_limit', 'guard_ai_recipe_ingredient', 'guard_athlete_session_columns', 'guard_athlete_session_insert', 'guard_client_goal_update', 'guard_client_nutrition_feedback', 'guard_client_nutrition_preferences', 'guard_direct_message_columns', 'guard_group_columns', 'guard_group_session_bookings', 'guard_membership_identity', 'guard_organization_columns', 'guard_partner_request_columns', 'guard_post_columns', 'guard_profile_sensitive_columns', 'guard_workout_log_columns', 'limit_food_favorites', 'note_series_session_skipped', 'notify_on_client_goal', 'notify_on_comment', 'notify_on_direct_message', 'notify_on_gym_visitor_lead', 'notify_on_macros_assigned', 'notify_on_mention', 'notify_on_nutrition_baseline', 'notify_on_nutrition_feedback', 'notify_on_nutrition_preferences', 'notify_on_partner_request', 'notify_on_post_mention', 'notify_on_program_assigned', 'notify_on_video_comment', 'notify_on_video_upload', 'phase_follows_confirmed_goal', 'prevent_platform_admin_self_escalation', 'recompute_training_max', 'recompute_workout_log', 'resurface_inactive_client', 'set_gwe_athlete_id', 'set_workout_athlete_id', 'set_workout_notes_athlete_id']) and has_function_privilege('authenticated', p.oid, 'execute')))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release O fix 2 (close the trigger functions; run any time after step 52), step 53 (0308) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g53$;

-- ====================================================================================================
-- migration 0308_close_trigger_functions.sql
-- ====================================================================================================

-- Release O fix, step 53: every trigger function a signed-in person could run by default is closed to the public and signed-in users, like every other internal function.
-- A trigger function can only ever run as a trigger (nobody can call it as a function or through the API), and the right to run it is checked when the trigger is created, not when
-- it fires, so no trigger stops firing. Their ACL before this was exactly: owner, authenticated, service_role. The undo grants authenticated back. notify_on_target_change is not
-- listed: step 52 (0307) closed it. Re-runnable; changes no data. A function that does not exist in this database is skipped.
do $sweep$
declare
  v_name text;
  v_names text[] := array[
    'audit_log_refuse_changes', 'audit_watch', 'backfill_placeholder_group_name', 'block_athlete_edits_to_completed_session',
    'clear_client_goal_phase_on_insert', 'default_client_tier_for_one_on_one', 'enforce_one_on_one_athlete_limit', 'guard_ai_recipe_ingredient',
    'guard_athlete_session_columns', 'guard_athlete_session_insert', 'guard_client_goal_update', 'guard_client_nutrition_feedback',
    'guard_client_nutrition_preferences', 'guard_direct_message_columns', 'guard_group_columns', 'guard_group_session_bookings',
    'guard_membership_identity', 'guard_organization_columns', 'guard_partner_request_columns', 'guard_post_columns',
    'guard_profile_sensitive_columns', 'guard_workout_log_columns', 'limit_food_favorites', 'note_series_session_skipped',
    'notify_on_client_goal', 'notify_on_comment', 'notify_on_direct_message', 'notify_on_gym_visitor_lead',
    'notify_on_macros_assigned', 'notify_on_mention', 'notify_on_nutrition_baseline', 'notify_on_nutrition_feedback',
    'notify_on_nutrition_preferences', 'notify_on_partner_request', 'notify_on_post_mention', 'notify_on_program_assigned',
    'notify_on_video_comment', 'notify_on_video_upload', 'phase_follows_confirmed_goal', 'prevent_platform_admin_self_escalation',
    'recompute_training_max', 'recompute_workout_log', 'resurface_inactive_client', 'set_gwe_athlete_id',
    'set_workout_athlete_id', 'set_workout_notes_athlete_id'
  ];
begin
  foreach v_name in array v_names loop
    if to_regprocedure('public.' || v_name || '()') is not null then
      execute format('revoke all on function public.%I() from public, anon, authenticated', v_name);
    end if;
  end loop;
end
$sweep$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 53 (0308)' as step, '0308 Release O fix: every trigger function that signed-in users could run by default is closed to the public and signed-in users' as what, not ((exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and p.proname = any (array['audit_log_refuse_changes', 'audit_watch', 'backfill_placeholder_group_name', 'block_athlete_edits_to_completed_session', 'clear_client_goal_phase_on_insert', 'default_client_tier_for_one_on_one', 'enforce_one_on_one_athlete_limit', 'guard_ai_recipe_ingredient', 'guard_athlete_session_columns', 'guard_athlete_session_insert', 'guard_client_goal_update', 'guard_client_nutrition_feedback', 'guard_client_nutrition_preferences', 'guard_direct_message_columns', 'guard_group_columns', 'guard_group_session_bookings', 'guard_membership_identity', 'guard_organization_columns', 'guard_partner_request_columns', 'guard_post_columns', 'guard_profile_sensitive_columns', 'guard_workout_log_columns', 'limit_food_favorites', 'note_series_session_skipped', 'notify_on_client_goal', 'notify_on_comment', 'notify_on_direct_message', 'notify_on_gym_visitor_lead', 'notify_on_macros_assigned', 'notify_on_mention', 'notify_on_nutrition_baseline', 'notify_on_nutrition_feedback', 'notify_on_nutrition_preferences', 'notify_on_partner_request', 'notify_on_post_mention', 'notify_on_program_assigned', 'notify_on_video_comment', 'notify_on_video_upload', 'phase_follows_confirmed_goal', 'prevent_platform_admin_self_escalation', 'recompute_training_max', 'recompute_workout_log', 'resurface_inactive_client', 'set_gwe_athlete_id', 'set_workout_athlete_id', 'set_workout_notes_athlete_id']) and has_function_privilege('authenticated', p.oid, 'execute')))) as in_place
) as result order by step;
