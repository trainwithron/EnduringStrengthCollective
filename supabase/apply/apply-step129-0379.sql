-- STEP 129: 0379 A program day or logged session exercise can never be named with only numbers or with its sets and reps
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. From now on a program day or a logged session refuses an exercise whose name is only digits, commas, dots and spaces (10,10,10) or that carries its sets and reps (Sumo Squat 3x10). The rows already there (77 logged exercises and 1 program exercise) are not touched or deleted; an edit to one of those rows is refused until it is renamed or removed.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_constraint where conname in ('group_workout_exercises_name_not_digits', 'session_exercises_name_not_digits')))) then
    raise exception 'Step 129 (0379) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0379_names_never_numbers_in_sessions_and_programs.sql
-- ====================================================================================================

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

commit;
