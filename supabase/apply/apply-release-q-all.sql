-- RELEASE Q (THE COACH'S OWN NAME FOR AN EXERCISE): ONE paste. Steps 55 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 55: Nothing changes until the code of the same release is live. After that, when a coach picks an exercise through one of their aliases (for example RFESS for the Bulgarian split squat) their program, the client's workout page and the logger show the coach's name, and every record and history lookup still uses the real exercise. Every existing exercise keeps showing exactly what it shows now.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release Q (the coach's own name for an exercise), step 55: 0310 The coach's own name for an exercise: one new optional column on the program's exercises (display_name), set only when a coach picks an exercise through their own alias. The real exercise name is untouched, so history, personal records and progression keep matching; only what is shown uses the coach's name
do $g55$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('group_workout_exercises exists', to_regclass('public.group_workout_exercises') is not null),
      ('0310 is not already applied (the display_name column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'display_name'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release Q (the coach''s own name for an exercise), step 55 (0310) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g55$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 55 (0310)' as step, '0310 The coach''s own name for an exercise: one new optional column on the program''s exercises' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'display_name'))) as in_place
) as result order by step;
