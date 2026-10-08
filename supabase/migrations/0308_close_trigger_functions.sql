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
