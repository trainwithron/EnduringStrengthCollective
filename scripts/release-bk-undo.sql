-- Puts every row this move changed back in the group it was in, then drops the log. Rows are matched by the log, so anything created in the personal space since is left where it is.
update public.programs t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'programs' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.workouts t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'workouts' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.group_workout_exercises t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'group_workout_exercises' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.workout_notes t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'workout_notes' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.workout_assignments t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'workout_assignments' and t.workout_id::text || ':' || t.athlete_id::text = l.row_id and t.group_id = l.new_group_id;
update public.exercise_progressions t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'exercise_progressions' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.athlete_exercise_overrides t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'athlete_exercise_overrides' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.athlete_sessions t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'athlete_sessions' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.workout_logs t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'workout_logs' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.session_coach_notes t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'session_coach_notes' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.session_pattern_checks t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'session_pattern_checks' and t.id::text = l.row_id and t.group_id = l.new_group_id;
update public.wellness_checkins t set group_id = l.old_group_id from public.personal_space_move_log l where l.tbl = 'wellness_checkins' and t.id::text = l.row_id and t.group_id = l.new_group_id;
drop table public.personal_space_move_log;
