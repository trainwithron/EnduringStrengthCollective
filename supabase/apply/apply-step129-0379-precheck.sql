-- STEP 129 (PRECHECK, run first, changes nothing): 0379 A program day or logged session exercise can never be named with only numbers or with its sets and reps
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0379 is not already applied (no rules yet)',
      not exists (select 1 from pg_constraint where conname in ('group_workout_exercises_name_not_digits', 'session_exercises_name_not_digits'))),
    ('the program exercises and session exercises tables exist',
      to_regclass('public.group_workout_exercises') is not null and to_regclass('public.session_exercises') is not null)
) as checks(check_name, ok);
