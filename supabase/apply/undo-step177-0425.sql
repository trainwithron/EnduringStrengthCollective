-- UNDO for step 177 (0425). Only if step 177 misbehaves. Puts the function back to its 0348 text (the wall follows the last group opened again).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
create or replace function public.request_workspace_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select g.organization_id
  from (select (nullif(current_setting('request.headers', true), '')::json ->> 'x-workspace-group') as v) h
  join public.groups g
    on g.id = case when h.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then h.v::uuid end
  where public.org_wall_header_enabled()
$$;
revoke execute on function public.request_workspace_org() from public, anon;
grant execute on function public.request_workspace_org() to authenticated, service_role;
commit;
