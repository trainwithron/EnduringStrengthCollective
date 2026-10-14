-- UNDO for step 86 (0340). Only if step 86 misbehaves (for example a coach is told 'That person is not a member of this group' for a client who really is in the group). Removes the rule from all 28 tables and puts back the earlier move, membership and comment rules.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists minor_consent_enforce_athlete_in_group on public.minor_consent;
drop trigger if exists daily_macros_enforce_athlete_in_group on public.daily_macros;
drop trigger if exists meal_plans_enforce_athlete_in_group on public.meal_plans;
drop trigger if exists athlete_injury_status_enforce_athlete_in_group on public.athlete_injury_status;
drop trigger if exists athlete_sessions_enforce_athlete_in_group on public.athlete_sessions;
drop trigger if exists bookings_enforce_athlete_in_group on public.bookings;
drop trigger if exists programs_enforce_athlete_in_group on public.programs;
drop trigger if exists workout_assignments_enforce_athlete_in_group on public.workout_assignments;
drop trigger if exists coach_video_checkins_enforce_athlete_in_group on public.coach_video_checkins;
drop trigger if exists nutrition_checkins_enforce_athlete_in_group on public.nutrition_checkins;
drop trigger if exists nutrition_phases_enforce_athlete_in_group on public.nutrition_phases;
drop trigger if exists client_habits_enforce_athlete_in_group on public.client_habits;
drop trigger if exists session_credits_enforce_athlete_in_group on public.session_credits;
drop trigger if exists wellness_checkins_enforce_athlete_in_group on public.wellness_checkins;
drop trigger if exists kiosk_checkins_enforce_athlete_in_group on public.kiosk_checkins;
drop trigger if exists athlete_exercise_overrides_enforce_athlete_in_group on public.athlete_exercise_overrides;
drop trigger if exists body_weight_logs_enforce_athlete_in_group on public.body_weight_logs;
drop trigger if exists nutrition_checkin_suggestions_enforce_athlete_in_group on public.nutrition_checkin_suggestions;
drop trigger if exists client_goals_enforce_athlete_in_group on public.client_goals;
drop trigger if exists client_macro_targets_enforce_athlete_in_group on public.client_macro_targets;
drop trigger if exists client_phase_plans_enforce_athlete_in_group on public.client_phase_plans;
drop trigger if exists session_exercise_videos_enforce_athlete_in_group on public.session_exercise_videos;
drop trigger if exists transformation_milestones_enforce_athlete_in_group on public.transformation_milestones;
drop trigger if exists workout_notes_enforce_athlete_in_group on public.workout_notes;
drop trigger if exists workouts_enforce_athlete_in_group on public.workouts;
drop trigger if exists group_workout_exercises_enforce_athlete_in_group on public.group_workout_exercises;
drop trigger if exists booking_waitlist_entries_enforce_athlete_in_group on public.booking_waitlist_entries;
drop trigger if exists game_score_entries_enforce_athlete_in_group on public.game_score_entries;
do $undo$ declare r record; begin for r in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgfoid = 'public.enforce_athlete_in_group'::regproc and not t.tgisinternal loop execute format('drop trigger if exists %I on public.%I', r.tgname, r.relname); end loop; end $undo$;
drop function if exists public.enforce_athlete_in_group();
drop trigger if exists group_memberships_guard_org_move on public.group_memberships;
drop function if exists public.guard_membership_org_move();
create or replace function public.move_client_to_group(p_athlete_id uuid, p_from_group_id uuid, p_to_group_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_group_coach(p_from_group_id) or not public.is_group_coach(p_to_group_id) then
    raise exception 'Must coach both the source and destination group.';
  end if;

  -- A one-on-one space holds ONE client: say so plainly instead of failing later on a database rule.
  if public.is_one_on_one_group(p_to_group_id)
     and exists (select 1 from public.group_memberships where group_id = p_to_group_id and role = 'athlete' and profile_id <> p_athlete_id) then
    raise exception 'A one-on-one space holds one client, and this one already has theirs.';
  end if;

  if exists (
    select 1 from public.group_memberships
    where group_id = p_to_group_id and profile_id = p_athlete_id
  ) then
    raise exception 'This client is already a member of the destination group.';
  end if;

  update public.group_memberships set group_id = p_to_group_id
    where group_id = p_from_group_id and profile_id = p_athlete_id;

  update public.workout_logs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.session_credits set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.body_weight_logs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_notes set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.client_habits set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.daily_macros set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workout_assignments set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.bookings set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_sessions set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.meal_plans set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_exercise_overrides set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.credit_purchases set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.subscription_credit_grants set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.membership_subscriptions set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;

  update public.programs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workouts set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.group_workout_exercises set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workout_notes set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;

  delete from public.package_assignments
    where athlete_id = p_athlete_id
      and coach_package_id in (select id from public.coach_packages where group_id = p_from_group_id);
end;
$function$;
drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert to authenticated with check ((public.is_group_coach(group_id) and (profile_id = (select auth.uid()) or public.is_coach_of_athlete(profile_id))) or (profile_id = (select auth.uid()) and role = 'coach' and public.is_org_admin_of_group(group_id)));
drop function if exists public.group_closed_to_org_admin_join(uuid);
drop policy if exists "comments_insert_members" on public.comments;
create policy "comments_insert_members" on public.comments for insert to authenticated with check (author_id = (select auth.uid()) and public.is_group_member(group_id));
drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own" on public.comments for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
commit;
