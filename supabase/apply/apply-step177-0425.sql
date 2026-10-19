-- STEP 177: 0425 FIX 4: the organization wall follows the organization the person chose (replaces one function)
--
-- !! This REPLACES one function (request_workspace_org). It first reads the organization the app says the person chose (x-workspace-org), only when the person belongs to it, and otherwise falls back to the group header exactly as before. The paste checks the live function is exactly the text it replaces (0348), and stops if not.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the FIX 4 code is live (safe either order: until then no request sends the new header, so the rule is exactly as before). Then the organization the coach chose is the one every page shows, even on a page that belongs to a group of another organization.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.request_workspace_org()') and position('x-workspace-org' in p.prosrc) > 0))) then
    raise exception 'Step 177 (0425) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0425_org_wall_follows_active_org.sql
-- ====================================================================================================

-- FIX 4: one organization value everywhere. The organization wall (0348/0349) followed the LAST GROUP opened (x-workspace-group), so opening any page of another organization moved the whole app there.
-- It now follows the organization the person CHOSE (the app sends it as x-workspace-org), but only an organization the person belongs to (a seat in one of its groups, or an organization membership);
-- anything else, or no such header, falls back to the group header exactly as before (the same check and the same uuid pattern as 0348). Still gated by org_wall_header_enabled().
-- Replaces one function, same signature; group_in_active_org and every policy are unchanged.
create or replace function public.request_workspace_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when public.org_wall_header_enabled() then coalesce(
    (
      select o.id
      from (
        select case when x.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then x.v::uuid end as id
        from (select (nullif(current_setting('request.headers', true), '')::json ->> 'x-workspace-org') as v) x
      ) o
      where o.id is not null
        and (
          exists (select 1 from public.group_memberships gm join public.groups g on g.id = gm.group_id where gm.profile_id = auth.uid() and g.organization_id = o.id)
          or exists (select 1 from public.organization_memberships om where om.organization_id = o.id and om.profile_id = auth.uid())
        )
    ),
    (
      select g.organization_id
      from (select (nullif(current_setting('request.headers', true), '')::json ->> 'x-workspace-group') as v) h
      join public.groups g
        on g.id = case when h.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then h.v::uuid end
    )
  ) end
$$;
revoke execute on function public.request_workspace_org() from public, anon;
grant execute on function public.request_workspace_org() to authenticated, service_role;

commit;
