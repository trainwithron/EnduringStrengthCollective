-- STEP 127: 0377 A library exercise can never be named with only numbers
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. From now on the library refuses a new exercise or a rename whose name is only digits, commas, dots and spaces (1, 8,8,8, 20). Names such as 5/3/1, 21s, Day 1 and 10x10 are fine. The rows already there are not touched or deleted.
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

-- Release CG: an exercise in the library can never be named with only digits, commas, dots and spaces ("1", "8,8,8", "20"). Those came from a misread import file (a rep list or a counter read as the exercise name).
-- NOT VALID: the rule applies to every new row and every rename from now on, and the rows that are already there are left exactly as they are (nothing is deleted or changed; checking them is a later step once they are cleaned up).
-- Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass) then
    alter table public.exercise_library add constraint exercise_library_name_not_digits check (name !~ '^[0-9][0-9., ]*$') not valid;
  end if;
end $$;

commit;
