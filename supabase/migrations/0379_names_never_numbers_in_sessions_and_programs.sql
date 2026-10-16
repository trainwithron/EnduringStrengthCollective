-- Release CH: the exercise name on a program day (group_workout_exercises) and on a logged session (session_exercises) can never be only digits, commas, dots and spaces ("10,10,10", "20"), or carry its sets
-- and reps ("Sumo Squat 3x10", "Squat 3 sets", "Row @7"). The same rule as the exercise library (0377). A wrongly laid-out file once saved the reps as the exercise names of 77 logged exercises.
-- NOT VALID: the rule applies to every new row and every rename from now on; the rows already there are left exactly as they are (nothing is deleted or changed). Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'group_workout_exercises_name_not_digits' and conrelid = 'public.group_workout_exercises'::regclass) then
    alter table public.group_workout_exercises add constraint group_workout_exercises_name_not_digits check (
      exercise_name !~ '^[0-9][0-9., ]*$' and exercise_name !~* '[0-9]+\s*[x\u00d7]\s*[0-9]+' and exercise_name !~* '[0-9]+\s*sets?\y' and exercise_name !~* '[0-9]+\s*reps?\s*$' and exercise_name !~ '@\s*[0-9][0-9.]*\s*$'
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'session_exercises_name_not_digits' and conrelid = 'public.session_exercises'::regclass) then
    alter table public.session_exercises add constraint session_exercises_name_not_digits check (
      exercise_name !~ '^[0-9][0-9., ]*$' and exercise_name !~* '[0-9]+\s*[x\u00d7]\s*[0-9]+' and exercise_name !~* '[0-9]+\s*sets?\y' and exercise_name !~* '[0-9]+\s*reps?\s*$' and exercise_name !~ '@\s*[0-9][0-9.]*\s*$'
    ) not valid;
  end if;
end $$;
