-- STEP 55 (PRECHECK, run first, changes nothing): 0310 The coach's own name for an exercise: one new optional column on the program's exercises (display_name), set only when a coach picks an exercise through their own alias, and the program copy (Assign to client, Duplicate) carries it across. The real exercise name is untouched, so history, personal records and progression keep matching; only what is shown uses the coach's name
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('group_workout_exercises exists',
      to_regclass('public.group_workout_exercises') is not null),
    ('the program copy function exists',
      to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is not null),
    ('0310 is not already applied (the display_name column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'display_name'))
) as checks(check_name, ok);
