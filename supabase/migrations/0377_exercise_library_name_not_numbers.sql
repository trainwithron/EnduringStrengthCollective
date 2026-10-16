-- Release CG: the exercise library (and the name an alias points to) can never hold a name that is only digits, commas, dots and spaces ("1", "8,8,8", "20"), or one that carries its sets and reps
-- ("Sumo Squat 3x10", "Squat 3 sets", "Squat 10 reps", "Row @7"). Both come from a misread file or a typed prescription kept as a name.
-- NOT VALID: the rule applies to every new row and every rename from now on, and the rows that are already there are left exactly as they are (nothing is deleted or changed; checking them is a later step once they
-- are cleaned up). Real names such as 5/3/1, 21s, Day 1, Hex Bar Deadlift and 3 Rep Pause Squat are fine. Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass) then
    alter table public.exercise_library add constraint exercise_library_name_not_digits check (
      name !~ '^[0-9][0-9., ]*$' and name !~* '[0-9]+\s*[x\u00d7]\s*[0-9]+' and name !~* '[0-9]+\s*sets?\y' and name !~* '[0-9]+\s*reps?\s*$' and name !~ '@\s*[0-9][0-9.]*\s*$'
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exercise_aliases_target_not_digits' and conrelid = 'public.exercise_aliases'::regclass) then
    alter table public.exercise_aliases add constraint exercise_aliases_target_not_digits check (
      exercise_name !~ '^[0-9][0-9., ]*$' and exercise_name !~* '[0-9]+\s*[x\u00d7]\s*[0-9]+' and exercise_name !~* '[0-9]+\s*sets?\y' and exercise_name !~* '[0-9]+\s*reps?\s*$' and exercise_name !~ '@\s*[0-9][0-9.]*\s*$'
    ) not valid;
  end if;
end $$;
