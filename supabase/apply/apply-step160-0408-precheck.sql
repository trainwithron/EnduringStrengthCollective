-- STEP 160 (PRECHECK, run first, changes nothing): 0408 Release B1: a coach can switch off automatic nutrition suggestions for one client (a coach-only note per client)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0408 is not already applied (the flags table is not there yet)',
      to_regclass('public.client_nutrition_flags') is null),
    ('the tables and helper it uses exist',
      to_regclass('public.groups') is not null and to_regclass('public.profiles') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null)
) as checks(check_name, ok);
