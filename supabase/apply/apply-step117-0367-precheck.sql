-- STEP 117 (PRECHECK, run first, changes nothing): 0367 A rest can be a range: a new empty column holds the high end (the low end stays where it is), and Duplicate copies it
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0367 is not already applied (no rest high-end column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercise_sets' and column_name = 'target_rest_max_seconds')),
    ('Release BV is applied (Duplicate knows about slots)',
      position('is_slot' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) > 0)
) as checks(check_name, ok);
