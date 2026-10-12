-- Release BA: switches the organization-wall request header rule ON (installed switched off by Release AZ). From here, a request that names a workspace sees and changes only that workspace's
-- organization on every table whose rows belong to a group. To switch it off again, put back "select false" (undo of this step).
create or replace function public.org_wall_header_enabled()
returns boolean
language sql
stable
set search_path = public
as $$ select true $$;
