-- STEP 30: copy the program christmas_abs_program from Main Group into The Home Team (nothing is deleted; run check-copy-result.sql afterwards and look at it before step 31)
--
-- !! Run AFTER step 26 (The Home Team moved into Coast2Coast Fitness). The original program is not touched. Afterwards run check-copy-result.sql: it shows the original and the copy side by side.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: The Home Team has a third program, christmas_abs_program, an exact copy (same weeks, workouts, exercises, sets, notes and progressions) of the one in Main Group. Run check-copy-result.sql to see the counts side by side.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program'))) then
    raise exception 'Step 30 (copy-main-group-program) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- copy-main-group-program: one-time data change
-- ====================================================================================================

-- Copies the program christmas_abs_program (66 workouts, in Main Group) into The Home Team with the app's own all-or-nothing copy function (duplicate_program: every week,
-- workout, exercise, set, note and progression, in one go). The original is not touched. Then it checks the copy has exactly the same number of workouts,
-- exercises and sets, and stops (nothing is kept) if not.
do $copy$
declare
  v_new uuid;
  a int; b int; c int; d int; e int; f int;
begin
  if exists (select 1 from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program') then
    raise exception 'The Home Team already has a program with that name, so nothing was copied.';
  end if;
  v_new := public.duplicate_program('5b8a8a3a-344d-4192-a892-f74494fff9ab', '060017b5-e613-4204-a101-c6a14c3a9630', '136394ed-f108-4283-bcb7-310a1ac6cbc8', null, null, null);
  select count(*) into a from public.workouts where program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';
  select count(*) into b from public.workouts where program_id = v_new;
  select count(*) into c from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';
  select count(*) into d from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = v_new;
  select count(*) into e from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';
  select count(*) into f from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = v_new;
  if a <> b or c <> d or e <> f or a = 0 then
    raise exception 'The copy does not match the original (workouts % vs %, exercises % vs %, sets % vs %), so nothing was kept.', a, b, c, d, e, f;
  end if;
end
$copy$;

commit;
