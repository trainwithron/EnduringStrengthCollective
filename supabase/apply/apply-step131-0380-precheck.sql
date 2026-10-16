-- STEP 131 (PRECHECK, run first, changes nothing): 0380 A day number is unique inside a week of a program
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0380 is not already applied (the rule is not there yet)',
      not exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass)),
    ('no program has two days with the same week and day number (run step 130 first if this says false)',
      not exists (select 1 from public.workouts group by program_id, week_number, day_index having count(*) > 1))
) as checks(check_name, ok);
