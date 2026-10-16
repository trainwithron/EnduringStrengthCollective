-- STEP 127 (PRECHECK, run first, changes nothing): 0377 A library exercise can never be named with only numbers
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0377 is not already applied (no rule yet)',
      not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass)),
    ('the exercise library exists',
      to_regclass('public.exercise_library') is not null)
) as checks(check_name, ok);
