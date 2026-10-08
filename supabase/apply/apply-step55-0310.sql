-- STEP 55: 0310 The coach's own name for an exercise: one new optional column on the program's exercises (display_name), set only when a coach picks an exercise through their own alias. The real exercise name is untouched, so history, personal records and progression keep matching; only what is shown uses the coach's name
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes until the code of the same release is live. After that, when a coach picks an exercise through one of their aliases (for example RFESS for the Bulgarian split squat) their program, the client's workout page and the logger show the coach's name, and every record and history lookup still uses the real exercise. Every existing exercise keeps showing exactly what it shows now.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'display_name'))) then
    raise exception 'Step 55 (0310) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0310_exercise_display_name.sql
-- ====================================================================================================

-- Release Q: the name a coach typed for an exercise, shown on their program, while it stays linked to the ONE real exercise underneath.
--  * group_workout_exercises.display_name: null for almost every row. It is set only when the coach picks an exercise through one of their own aliases ("RFESS" for the Bulgarian split
--    squat). exercise_name keeps holding the real exercise, so history, personal records, last time, progression, the AI builder and the library all keep matching on it; only what is SHOWN
--    (the builder, the client's workout page and the logger) uses display_name when there is one.
--  * A length limit so it stays a name. Nothing else changes: no policy, no function, no other table. A client reads it through the policies they already have on their program's exercises.
-- New column only. Re-runnable.

alter table public.group_workout_exercises add column if not exists display_name text;

do $q$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'group_workout_exercises_display_name_len' and conrelid = 'public.group_workout_exercises'::regclass
  ) then
    alter table public.group_workout_exercises
      add constraint group_workout_exercises_display_name_len check (display_name is null or char_length(btrim(display_name)) between 1 and 120);
  end if;
end
$q$;

comment on column public.group_workout_exercises.display_name is 'The coach''s own name for the exercise, shown instead of exercise_name; set only when picked through an alias. Every lookup (history, records, progression) still uses exercise_name.';

commit;
