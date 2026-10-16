-- STEP 128 (PRECHECK, run first, changes nothing): 0378 Moving a client to another group moves all of their records
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0378 is not already applied (the move does not yet find every table)',
      to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)') is not null and pg_get_functiondef(to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)')) not like '%information_schema.columns%'),
    ('the session coach notes and progression rules tables exist',
      to_regclass('public.session_coach_notes') is not null and to_regclass('public.exercise_progressions') is not null)
) as checks(check_name, ok);
