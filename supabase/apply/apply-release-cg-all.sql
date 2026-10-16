-- RELEASE CG (THE EXERCISE LIBRARY REFUSES NAMES MADE ONLY OF NUMBERS; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 127 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 127: Nothing changes on screen. From now on the library refuses a new exercise or a rename whose name is only digits, commas, dots and spaces (1, 8,8,8, 20) or that carries its sets and reps (Sumo Squat 3x10, Squat 3 sets, Row @7), and an alias cannot point to such a name. Names such as 5/3/1, 21s, Day 1 and Hex Bar Deadlift are fine. The rows already there are not touched or deleted.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CG (the exercise library refuses names made only of numbers; run BEFORE the code that goes with it is live), step 127: 0377 A library exercise can never be named with only numbers or with its sets and reps
do $g127$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0377 is not already applied (no rule yet)', not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass)),
      ('the exercise library and the aliases exist', to_regclass('public.exercise_library') is not null and to_regclass('public.exercise_aliases') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CG (the exercise library refuses names made only of numbers; run BEFORE the code that goes with it is live), step 127 (0377) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g127$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 127 (0377)' as step, '0377 A library exercise can never be named with only numbers or with its sets and reps' as what, not ((not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass))) as in_place
) as result order by step;
