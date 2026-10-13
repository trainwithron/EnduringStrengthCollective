-- STEP 116 (PRECHECK, run first, changes nothing): 0366 Template slots survive Duplicate, and a program that still has a slot cannot be given to a client (the duplicate-program function is replaced; the two flags added by step 115 may be empty so the old restore scripts still work)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0366 is not already applied (the duplicate-program function does not know about slots yet)',
      position('is_slot' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) = 0),
    ('Release BU is applied (the slot columns exist)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'is_slot'))
) as checks(check_name, ok);
