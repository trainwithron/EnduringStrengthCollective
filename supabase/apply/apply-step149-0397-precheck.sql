-- STEP 149 (PRECHECK, run first, changes nothing): 0397 Release F2: the free plan's client limit (15 training clients), installed SWITCHED OFF
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0397 is not already applied (the limit trigger is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'group_memberships_free_tier_limit' and not tgisinternal)),
    ('the tables it reads exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.groups') is not null and to_regclass('public.organizations') is not null and to_regclass('public.organization_billing') is not null)
) as checks(check_name, ok);
