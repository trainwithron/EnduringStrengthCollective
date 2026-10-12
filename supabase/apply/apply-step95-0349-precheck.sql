-- STEP 95 (PRECHECK, run first, changes nothing): 0349 Switch the organization-wall request header rule ON
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('step 94 is applied (the switch function exists)',
      to_regprocedure('public.org_wall_header_enabled()') is not null),
    ('0349 is not already applied (the rule is still off)',
      position('select true' in pg_get_functiondef(to_regprocedure('public.org_wall_header_enabled()'))) = 0)
) as checks(check_name, ok);
