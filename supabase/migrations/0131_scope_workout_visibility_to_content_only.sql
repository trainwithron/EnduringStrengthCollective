-- Real production regression found via independent differential testing
-- against every real scheduled workout (reported by a peer session,
-- verified directly here by re-reading 0128 and lib/todays-workout.ts):
-- 0128 applied is_workout_visible_to_athlete() to the `workouts` table
-- itself, not just group_workout_exercises/group_workout_exercise_sets.
-- That hid the ROW for a locked workout entirely, not just its
-- exercise/set content — which broke every consumer that needs to see
-- a locked workout exists (to render "locked"/"unlocks on" state):
-- Week/Month view render future weeks as empty "Rest day" instead of
-- locked, a program's full week count silently shrinks, and worst of
-- all, lib/todays-workout.ts's `next` lookup (the query behind it never
-- returning the locked row at all) falls through to `{status:"done"}`
-- before its own lock-detection branch ever runs — telling an athlete
-- they've finished their whole program when a future workout is simply
-- locked.
--
-- The original 0128 security finding was specifically about exercise
-- NAMES and SET DATA leaking early (confirmed live at the time) — never
-- about whether the workout row/title/date itself should be hidden.
-- This restores workouts_select_members to its exact pre-0128 shape
-- (0065_per_client_programs.sql) — every group member can see that a
-- workout exists, titled, dated — while gwe_select_members and
-- gwes_select_members (the actual leak vector, and the actual fix)
-- stay exactly as 0128 left them, completely untouched.
drop policy "workouts_select_members" on public.workouts;
create policy "workouts_select_members" on public.workouts for select
  to authenticated using (
    is_group_member(group_id)
    and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id))
  );
