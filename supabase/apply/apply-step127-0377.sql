-- STEP 127: 0377 A library exercise can never be named with only numbers or with its sets and reps
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. From now on the library refuses a new exercise or a rename whose name is only digits, commas, dots and spaces (1, 8,8,8, 20) or that carries its sets and reps (Sumo Squat 3x10, Squat 3 sets, Row @7), and an alias cannot point to such a name. Names such as 5/3/1, 21s, Day 1 and Hex Bar Deadlift are fine. The rows already there are not touched or deleted.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass))) then
    raise exception 'Step 127 (0377) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0377_exercise_library_name_not_numbers.sql
-- ====================================================================================================

-- Release CG: the exercise library (and the name an alias points to) can never hold a name that is only digits, commas, dots and spaces ("1", "8,8,8", "20"), or one that carries its sets and reps
-- ("Sumo Squat 3x10", "Squat 3 sets", "Squat 10 reps", "Row @7"). Both come from a misread file or a typed prescription kept as a name.
-- NOT VALID: the rule applies to every new row and every rename from now on, and the rows that are already there are left exactly as they are (nothing is deleted or changed; checking them is a later step once they
-- are cleaned up). Real names such as 5/3/1, 21s, Day 1, Hex Bar Deadlift and 3 Rep Pause Squat are fine. Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass) then
    alter table public.exercise_library add constraint exercise_library_name_not_digits check (
      name !~ '^[0-9][0-9., ]*$' and name !~* '[0-9]+\s*[x\u00d7]\s*[0-9]+' and name !~* '[0-9]+\s*sets?\y' and name !~* '[0-9]+\s*reps?\s*$' and name !~ '@\s*[0-9]'
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exercise_aliases_target_not_digits' and conrelid = 'public.exercise_aliases'::regclass) then
    alter table public.exercise_aliases add constraint exercise_aliases_target_not_digits check (
      exercise_name !~ '^[0-9][0-9., ]*$' and exercise_name !~* '[0-9]+\s*[x\u00d7]\s*[0-9]+' and exercise_name !~* '[0-9]+\s*sets?\y' and exercise_name !~* '[0-9]+\s*reps?\s*$' and exercise_name !~ '@\s*[0-9]'
    ) not valid;
  end if;
end $$;

commit;
