-- STEP 172 (PRECHECK, run first, changes nothing): 0420 Release OWN1: ownership of an organization cannot be handed to someone who has never signed in
--
-- !! This REPLACES two functions (transfer_organization_ownership and guard_organization_columns) and adds one function and one trigger. Each replacement only adds the refusal; the paste checks that both live functions are exactly the text they replace, and stops if not.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0420 is not already applied (the new membership guard is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'organization_memberships_guard_owner_role' and not tgisinternal)),
    ('the transfer function is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '234f41b71d19ee8853dc432b95d7283c' from pg_proc p where p.oid = to_regprocedure('public.transfer_organization_ownership(uuid, uuid)')), false)),
    ('the organization guard is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'a8c146d8aa8dd143bf9a05b497ccc1f9' from pg_proc p where p.oid = to_regprocedure('public.guard_organization_columns()')), false)),
    ('the function it replaces exists',
      to_regprocedure('public.transfer_organization_ownership(uuid, uuid)') is not null and to_regprocedure('public.guard_organization_columns()') is not null),
    ('the account columns it reads exist',
      (select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at') = 1)
) as checks(check_name, ok);
