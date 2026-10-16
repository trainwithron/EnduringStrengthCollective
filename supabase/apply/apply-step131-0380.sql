-- STEP 131: 0380 A day number is unique inside a week of a program
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. From now on two days of one program cannot get the same week and day number at the same moment; the app picks the next free number and tries again if it loses a race.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass))) then
    raise exception 'Step 131 (0380) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0380_program_day_numbers_unique.sql
-- ====================================================================================================

-- Release CI: a day number is unique inside a week of a program (two days can no longer both be "Week 1, Day 1" when two tabs or a double click add a day at the same moment).
-- The app now reads the next free number from what is saved and retries when it loses a race. Needs every program to have only one day per number already (step 130 fixes the one program that had two). Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass) then
    alter table public.workouts add constraint workouts_program_week_day_key unique (program_id, week_number, day_index);
  end if;
end $$;

commit;
