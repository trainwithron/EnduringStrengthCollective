-- STEP 94 (PRECHECK, run first, changes nothing): 0348 Defense in depth for the organization walls, installed switched OFF: the database learns to refuse a row of a different organization than the workspace a request names (nothing changes until step 95)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0348 is not already applied (the workspace helper does not exist yet)',
      to_regprocedure('public.request_workspace_org()') is null),
    ('the group and organization tables the rule reads exist',
      to_regclass('public.groups') is not null and to_regclass('public.programs') is not null and to_regclass('public.bookings') is not null)
) as checks(check_name, ok);
