-- FIX 4 (THE ORGANIZATION WALL FOLLOWS THE ORGANIZATION THE PERSON CHOSE; REPLACES ONE FUNCTION): ONE paste. Steps 177 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 177: Nothing changes on screen until the FIX 4 code is live (safe either order: until then no request sends the new header, so the rule is exactly as before). Then the organization the coach chose is the one every page shows, even on a page that belongs to a group of another organization.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== FIX 4 (the organization wall follows the organization the person chose; replaces one function), step 177: 0425 FIX 4: the organization wall follows the organization the person chose (replaces one function)
do $g177$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0425 is not already applied (the function does not read the organization header yet)', not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.request_workspace_org()') and position('x-workspace-org' in p.prosrc) > 0)),
      ('the function is exactly the text this replaces (0348)', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'c473cde0ef535c443f12c98d76baa6fb' from pg_proc p where p.oid = to_regprocedure('public.request_workspace_org()')), false)),
      ('the tables it reads exist', to_regclass('public.organization_memberships') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.groups') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'FIX 4 (the organization wall follows the organization the person chose; replaces one function), step 177 (0425) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g177$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 177 (0425)' as step, '0425 FIX 4: the organization wall follows the organization the person chose' as what, not ((not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.request_workspace_org()') and position('x-workspace-org' in p.prosrc) > 0))) as in_place
) as result order by step;
