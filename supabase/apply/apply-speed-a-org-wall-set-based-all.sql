-- SPEED A (THE ORGANIZATION WALL ASKS ONCE PER QUERY, NOT ONCE PER ROW: ONE FUNCTION, 90 POLICIES REWRITTEN IN PLACE): ONE paste. Steps 178 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 178: Nothing looks different; pages that read many rows (Programs, Home) answer faster. Safe with or without the FIX 4 code: it only calls request_workspace_org.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== SPEED A (the organization wall asks once per query, not once per row: one function, 90 policies rewritten in place), step 178: 0426 SPEED A: the organization wall asks once per query, not once per row (one new function; the 90 org_wall_header policies rewritten in place)
do $g178$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0426 is not already applied (the set function is not there yet)', not (to_regprocedure('public.active_org_group_ids()') is not null)),
      ('every org_wall_header policy still reads exactly group_in_active_org(group_id)', (select count(*) from pg_policies where schemaname = 'public' and policyname = 'org_wall_header') > 0 and (select count(*) from pg_policies where schemaname = 'public' and policyname = 'org_wall_header' and (qual is distinct from 'group_in_active_org(group_id)' or with_check is distinct from 'group_in_active_org(group_id)')) = 0),
      ('group_in_active_org is exactly the text this matches (0358: the personal space passes)', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '16adf3eebb81c0762e6c0904df85b3e6' from pg_proc p where p.oid = to_regprocedure('public.group_in_active_org(uuid)')), false))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'SPEED A (the organization wall asks once per query, not once per row: one function, 90 policies rewritten in place), step 178 (0426) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g178$;

-- ====================================================================================================
-- migration 0426_org_wall_set_based.sql
-- ====================================================================================================

-- SPEED migration A: the organization wall (the restrictive org_wall_header policy on 90 tables) asked group_in_active_org(group_id) once PER ROW, which reads the request headers and the groups table
-- for every row (Programs as Ron: 1,378 ms with the wall, 660 ms without). It now asks once per query: the active organization is worked out once ((select request_workspace_org()) is an initplan),
-- and its groups are read once as a set. It means EXACTLY what the live group_in_active_org means:
--   no workspace named, or the row has no group, or the row's group belongs to the named workspace's organization, or the row's group belongs to NO organization (the personal space).
-- (Checked on the live data before the paste, read-only: every row of all 90 tables, for each organization, no workspace and a bad header, gives the same answer both ways.)
-- Every org_wall_header policy is rewritten in place (same name, same restrictive ALL for authenticated); only one that still reads exactly group_in_active_org(group_id) is touched.
-- group_in_active_org stays (nothing else changes; a later table can still use it). Requires 0358 (the group_in_active_org it matches, which lets the personal space through).
create or replace function public.active_org_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select g.id from public.groups g where g.organization_id = public.request_workspace_org() or g.organization_id is null
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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 178 (0426)' as step, '0426 SPEED A: the organization wall asks once per query' as what, not ((not (to_regprocedure('public.active_org_group_ids()') is not null))) as in_place
) as result order by step;
