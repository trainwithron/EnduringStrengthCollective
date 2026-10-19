-- STEP 173 (PRECHECK, run first, changes nothing): 0421 Release TC3: one invitation link per invited person (one new table, only the server reads it; no link or secret is stored in it)
--
-- !! Additions only: one new table and two indexes. Nothing existing is changed.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0421 is not already applied (the links table is not there yet)',
      to_regclass('public.coach_join_links') is null),
    ('the tables it points at exist',
      to_regclass('public.organizations') is not null and to_regclass('public.profiles') is not null)
) as checks(check_name, ok);
