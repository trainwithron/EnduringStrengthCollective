-- STEP 121 (PRECHECK, run first, changes nothing): 0371 Unclear data points in imported history are marked, kept, and left out of the numbers
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0371 is not already applied (no mark column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag')),
    ('the set logs table exists',
      to_regclass('public.set_logs') is not null),
    ('the org wall check exists',
      to_regprocedure('public.group_in_active_org(uuid)') is not null)
) as checks(check_name, ok);
