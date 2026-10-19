-- STEP 178: 0426 SPEED A: the organization wall asks once per query, not once per row (one new function; the 90 org_wall_header policies rewritten in place)
--
-- !! This adds one function (active_org_group_ids) and rewrites the org_wall_header policy on every table that has it, in place (same name, same restrictive rule). It means exactly what group_in_active_org means today (checked on the live data, every row of all 90 tables). The paste checks that every one of those policies still reads exactly group_in_active_org(group_id) and that group_in_active_org is exactly the text it matches, and stops if not.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing looks different; pages that read many rows (Programs, Home) answer faster. Safe with or without the FIX 4 code: it only calls request_workspace_org.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not (to_regprocedure('public.active_org_group_ids()') is not null))) then
    raise exception 'Step 178 (0426) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0426_org_wall_set_based.sql
-- ====================================================================================================

-- SPEED migration A: the organization wall (the restrictive org_wall_header policy on 90 tables) asked group_in_active_org(group_id) once PER ROW, which reads the request headers and the groups table
-- for every row (Programs as Ron: 1,378 ms with the wall, 660 ms without). It now asks once per query: the active organization is worked out once ((select request_workspace_org()) is an initplan),
-- and its groups are read once as a set. The rows anyone can see are exactly the rows group_in_active_org lets them see:
--   no workspace named, or the row has no group, or the row's group belongs to the named workspace's organization, or the row's group is a personal space (no organization).
-- The personal-space part lists only the CALLER'S OWN personal spaces: a personal space is only ever readable by its own members, so what anyone can see is unchanged, and nobody is handed the ids of
-- everyone else's. Checked on the live data before the paste, read-only, per person (a coach in several organizations with a personal space, a client, an organization owner, a client kept private
-- from the organization), every table and every header: the rows the whole policy set lets through are the same both ways.
-- Every org_wall_header policy is rewritten in place (same name, same restrictive ALL for authenticated); only one that still reads exactly group_in_active_org(group_id) is touched.
-- group_in_active_org stays (nothing else changes; a later table can still use it). Requires 0358 (the group_in_active_org it matches, which lets the personal space through).
create or replace function public.active_org_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select g.id from public.groups g where g.organization_id = public.request_workspace_org()
  union
  select gm.group_id from public.group_memberships gm join public.groups g on g.id = gm.group_id where gm.profile_id = auth.uid() and g.organization_id is null
$$;
revoke execute on function public.active_org_group_ids() from public, anon;
grant execute on function public.active_org_group_ids() to authenticated, service_role;

do $$
declare
  r record;
  x text := '(select public.request_workspace_org()) is null or group_id is null or group_id in (select public.active_org_group_ids())';
begin
  for r in
    select tablename from pg_policies
    where schemaname = 'public' and policyname = 'org_wall_header'
      and qual = 'group_in_active_org(group_id)' and with_check = 'group_in_active_org(group_id)'
  loop
    execute format('alter policy org_wall_header on public.%I using (%s) with check (%s)', r.tablename, x, x);
  end loop;
end $$;

commit;
