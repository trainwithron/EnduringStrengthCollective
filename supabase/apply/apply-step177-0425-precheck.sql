-- STEP 177 (PRECHECK, run first, changes nothing): 0425 FIX 4: the organization wall follows the organization the person chose (replaces one function)
--
-- !! This REPLACES one function (request_workspace_org). It first reads the organization the app says the person chose (x-workspace-org), only when the person belongs to it, and otherwise falls back to the group header exactly as before. The paste checks the live function is exactly the text it replaces (0348), and stops if not.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0425 is not already applied (the function does not read the organization header yet)',
      not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.request_workspace_org()') and position('x-workspace-org' in p.prosrc) > 0)),
    ('the function is exactly the text this replaces (0348)',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'c473cde0ef535c443f12c98d76baa6fb' from pg_proc p where p.oid = to_regprocedure('public.request_workspace_org()')), false)),
    ('the tables it reads exist',
      to_regclass('public.organization_memberships') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.groups') is not null)
) as checks(check_name, ok);
