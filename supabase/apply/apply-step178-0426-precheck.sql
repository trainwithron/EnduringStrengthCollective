-- STEP 178 (PRECHECK, run first, changes nothing): 0426 SPEED A: the organization wall asks once per query, not once per row (one new function; the 90 org_wall_header policies rewritten in place)
--
-- !! This adds one function (active_org_group_ids) and rewrites the org_wall_header policy on every table that has it, in place (same name, same restrictive rule). It means exactly what group_in_active_org means today (checked on the live data, every row of all 90 tables). The paste checks that every one of those policies still reads exactly group_in_active_org(group_id) and that group_in_active_org is exactly the text it matches, and stops if not.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0426 is not already applied (the set function is not there yet)',
      not (to_regprocedure('public.active_org_group_ids()') is not null)),
    ('every org_wall_header policy still reads exactly group_in_active_org(group_id)',
      (select count(*) from pg_policies where schemaname = 'public' and policyname = 'org_wall_header') > 0 and (select count(*) from pg_policies where schemaname = 'public' and policyname = 'org_wall_header' and (qual is distinct from 'group_in_active_org(group_id)' or with_check is distinct from 'group_in_active_org(group_id)')) = 0),
    ('group_in_active_org is exactly the text this matches (0358: the personal space passes)',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '16adf3eebb81c0762e6c0904df85b3e6' from pg_proc p where p.oid = to_regprocedure('public.group_in_active_org(uuid)')), false))
) as checks(check_name, ok);
