-- STEP 81 (PRECHECK, run first, changes nothing): 0335 Assigning a program that belongs to no client to ONE client attaches it to that client (no copy is left behind)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0335 is not already applied (assign_program_to_client does not exist yet)',
      to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is null),
    ('the program copy function exists',
      to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is not null),
    ('programs can be removed from a profile (archived_at exists, 0328)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'archived_at')),
    ('the tables the attach checks exist',
      to_regclass('public.workout_logs') is not null and to_regclass('public.athlete_sessions') is not null and to_regclass('public.workout_assignments') is not null and to_regclass('public.challenges') is not null and to_regclass('public.exercise_progressions') is not null)
) as checks(check_name, ok);
