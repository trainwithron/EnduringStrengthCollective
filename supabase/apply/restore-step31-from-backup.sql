-- RESTORE for step 31 (delete-two-groups). Only if Main Group or the stray Coast to Coast group turns out to be needed again.
-- Puts back, from the most recent record in cleanup_backups, both groups with their memberships, programs, progressions, workouts, exercises, sets, notes,
-- wellness check-ins, view state and Spotter dismissals, in that order, in one transaction. It refuses (and changes nothing) if there is no backup, or if either
-- group already exists. The copy of christmas_abs_program in The Home Team is not touched.
-- Only reliable soon after step 31: it fills columns from the backup, so a NOT NULL column added by a later migration to one of these tables would make it fail (loudly, and nothing is kept).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
begin;
do $restore$
declare
  b record;
begin
  select * into b from public.cleanup_backups where label like 'delete Main Group%' order by taken_at desc limit 1;
  if b.id is null then raise exception 'There is no step 31 backup in cleanup_backups, so nothing was restored.'; end if;
  if exists (select 1 from public.groups where id in (select (x ->> 'id')::uuid from jsonb_array_elements(b.payload -> 'groups') x)) then
    raise exception 'One of the groups already exists, so nothing was restored.';
  end if;
  insert into public.groups select * from jsonb_populate_recordset(null::public.groups, b.payload -> 'groups');
  insert into public.group_memberships select * from jsonb_populate_recordset(null::public.group_memberships, b.payload -> 'memberships');
  insert into public.programs select * from jsonb_populate_recordset(null::public.programs, (select coalesce(jsonb_agg(x || jsonb_build_object('ai_draft', coalesce((x ->> 'ai_draft')::boolean, false))), '[]'::jsonb) from jsonb_array_elements(b.payload -> 'programs') x));
  insert into public.exercise_progressions select * from jsonb_populate_recordset(null::public.exercise_progressions, b.payload -> 'progressions');
  insert into public.workouts select * from jsonb_populate_recordset(null::public.workouts, b.payload -> 'workouts');
  insert into public.group_workout_exercises select * from jsonb_populate_recordset(null::public.group_workout_exercises, b.payload -> 'exercises');
  insert into public.group_workout_exercise_sets select * from jsonb_populate_recordset(null::public.group_workout_exercise_sets, b.payload -> 'sets');
  insert into public.workout_notes select * from jsonb_populate_recordset(null::public.workout_notes, b.payload -> 'notes');
  insert into public.wellness_checkins select * from jsonb_populate_recordset(null::public.wellness_checkins, b.payload -> 'wellness_checkins');
  insert into public.coach_view_state select * from jsonb_populate_recordset(null::public.coach_view_state, b.payload -> 'coach_view_state');
  insert into public.programming_spotter_dismissals select * from jsonb_populate_recordset(null::public.programming_spotter_dismissals, b.payload -> 'programming_spotter_dismissals');
end
$restore$;
commit;
