-- STEP 110 (PRECHECK, run first, changes nothing): 0361 The shared exercise catalog (empty): one list of real movements everyone can read and only the platform admin can write, and a link from each coach's library entry to its movement
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0361 is not already applied (the catalog table does not exist yet)',
      to_regclass('public.exercise_catalog') is null),
    ('the platform-admin helper and the exercise library exist',
      to_regprocedure('public.is_platform_admin()') is not null and to_regclass('public.exercise_library') is not null)
) as checks(check_name, ok);
