-- STEP 83 (PRECHECK, run first, changes nothing): 0337 Assigning a program attaches it only inside one organization (across organizations it makes a copy)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0337 is not already applied (the function does not yet compare organizations)',
      to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is not null and position('v_src_org' in pg_get_functiondef(to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)'))) = 0),
    ('the assign function from 0335 exists',
      to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is not null),
    ('groups have an organization_id',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'organization_id'))
) as checks(check_name, ok);
