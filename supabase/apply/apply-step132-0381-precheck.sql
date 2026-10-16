-- STEP 132 (PRECHECK, run first, changes nothing): 0381 A one-on-one space's name follows its client's name when the client's name is corrected
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0381 is not already applied (the function is not there yet)',
      to_regprocedure('public.sync_one_on_one_group_name()') is null),
    ('the profiles and groups tables exist',
      to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null)
) as checks(check_name, ok);
