-- Wave 2 T3 (Ron, Nov 20): "% of max" in programs, team programs included. The coach types 75% in a set's weight box; each athlete then sees their own weight, 75% of
-- their training max for that lift (the coach's locked tested max when there is one, step 214, else the estimate from logged sets), rounded to the nearest 5 lb. Worked out
-- in the app where the weight is shown; only the percent is stored, on the set, in place of a fixed weight. Re-running is safe.

alter table public.group_workout_exercise_sets add column if not exists target_pct_max numeric(5, 1);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.group_workout_exercise_sets'::regclass and conname = 'group_workout_exercise_sets_pct_max_range') then
    alter table public.group_workout_exercise_sets add constraint group_workout_exercise_sets_pct_max_range check (target_pct_max is null or (target_pct_max > 0 and target_pct_max <= 150));
  end if;
end;
$$;

-- Copying a program (duplicate_program) keeps each set's percent. Patched into the LIVE function: each piece found exactly once or nothing changes; already patched: skipped.
do $dup$
declare
  v_def text := replace(pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure), E'\r\n', E'\n');
  v_old1 text := E'        target_rest_seconds, target_rest_max_seconds, target_pace, set_type\n      )\n      select';
  v_old2 text := E'        target_rest_seconds, target_rest_max_seconds, target_pace, set_type\n      from public.group_workout_exercise_sets';
begin
  if position('target_pct_max' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1 or (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 then
    raise exception 'duplicate_program is not the version this step was built from. NOTHING was changed.';
  end if;
  v_def := replace(v_def, v_old1, E'        target_rest_seconds, target_rest_max_seconds, target_pace, set_type, target_pct_max\n      )\n      select');
  v_def := replace(v_def, v_old2, E'        target_rest_seconds, target_rest_max_seconds, target_pace, set_type, target_pct_max\n      from public.group_workout_exercise_sets');
  execute v_def;
end
$dup$;
