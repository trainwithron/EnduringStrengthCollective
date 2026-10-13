-- Names go back where they were, rows removed to resolve a clash come back, the merged-away library rows come back, renamed entries get their old names and videos back, the aliases and the catalog entries this step added go, and the two log tables are dropped.
update public.group_workout_exercises t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'group_workout_exercises' and l.col = 'exercise_name' and t.id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.session_exercises t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'session_exercises' and l.col = 'exercise_name' and t.id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.athlete_exercise_overrides t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'athlete_exercise_overrides' and l.col = 'exercise_name' and t.id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.exercise_progressions t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_progressions' and l.col = 'exercise_name' and t.id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.exercise_records t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_records' and l.col = 'exercise_name' and t.id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.game_score_entries t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'game_score_entries' and l.col = 'exercise_name' and t.id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.movement_pattern_exercises t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'movement_pattern_exercises' and l.col = 'exercise_name' and t.id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.exercise_biomech_tags t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_biomech_tags' and l.col = 'exercise_name' and t.id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.athlete_training_maxes t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'athlete_training_maxes' and l.col = 'exercise_name' and t.athlete_id::text = l.row_id and t.exercise_name = l.new_value #>> '{}';
update public.athlete_equipment_load_ratios t set exercise_name_a = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'athlete_equipment_load_ratios' and l.col = 'exercise_name_a' and t.id::text = l.row_id and t.exercise_name_a = l.new_value #>> '{}';
update public.athlete_equipment_load_ratios t set exercise_name_b = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'athlete_equipment_load_ratios' and l.col = 'exercise_name_b' and t.id::text = l.row_id and t.exercise_name_b = l.new_value #>> '{}';
update public.workout_logs t set new_prs = array(select jsonb_array_elements_text(l.old_value)) from public.exercise_catalog_merge_log l
  where l.tbl = 'workout_logs' and l.col = 'new_prs' and t.id::text = l.row_id;
update public.posts t set shared_exercise_names = array(select jsonb_array_elements_text(l.old_value)) from public.exercise_catalog_merge_log l
  where l.tbl = 'posts' and l.col = 'shared_exercise_names' and t.id::text = l.row_id;
update public.exercise_aliases t set exercise_name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_aliases' and l.col = 'exercise_name' and t.id::text = l.row_id;
delete from public.exercise_aliases t using public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_aliases' and l.col = '__inserted' and t.id::text = l.row_id;
update public.exercise_library t set name = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_library' and l.col = 'name' and t.id::text = l.row_id and t.name = l.new_value #>> '{}';
update public.exercise_library t set video_path = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_library' and l.col = 'video_path' and t.id::text = l.row_id;
update public.exercise_library t set youtube_url = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_library' and l.col = 'youtube_url' and t.id::text = l.row_id;
update public.exercise_library t set category = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_library' and l.col = 'category' and t.id::text = l.row_id;
update public.exercise_library t set equipment_type = l.old_value #>> '{}' from public.exercise_catalog_merge_log l
  where l.tbl = 'exercise_library' and l.col = 'equipment_type' and t.id::text = l.row_id;
insert into public.exercise_biomech_tags select r.* from public.exercise_catalog_merge_deleted d cross join lateral jsonb_populate_record(null::public.exercise_biomech_tags, d.row) r where d.tbl = 'exercise_biomech_tags';
insert into public.athlete_training_maxes select r.* from public.exercise_catalog_merge_deleted d cross join lateral jsonb_populate_record(null::public.athlete_training_maxes, d.row) r where d.tbl = 'athlete_training_maxes';
delete from public.exercise_catalog_aliases where batch = 'ron-merge-1';
delete from public.exercise_catalog where batch = 'ron-merge-1';
insert into public.exercise_library select r.* from public.exercise_catalog_merge_deleted d cross join lateral jsonb_populate_record(null::public.exercise_library, d.row) r where d.tbl = 'exercise_library';
insert into public.exercise_progressions select r.* from public.exercise_catalog_merge_deleted d cross join lateral jsonb_populate_record(null::public.exercise_progressions, d.row) r where d.tbl = 'exercise_progressions';
insert into public.movement_pattern_exercises select r.* from public.exercise_catalog_merge_deleted d cross join lateral jsonb_populate_record(null::public.movement_pattern_exercises, d.row) r where d.tbl = 'movement_pattern_exercises';
drop table public.exercise_catalog_merge_deleted;
drop table public.exercise_catalog_merge_log;
