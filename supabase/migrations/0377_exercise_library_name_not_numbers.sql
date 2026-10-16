-- Release CG: an exercise in the library can never be named with only digits, commas, dots and spaces ("1", "8,8,8", "20"). Those came from a misread import file (a rep list or a counter read as the exercise name).
-- NOT VALID: the rule applies to every new row and every rename from now on, and the rows that are already there are left exactly as they are (nothing is deleted or changed; checking them is a later step once they are cleaned up).
-- Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass) then
    alter table public.exercise_library add constraint exercise_library_name_not_digits check (name !~ '^[0-9][0-9., ]*$') not valid;
  end if;
end $$;
