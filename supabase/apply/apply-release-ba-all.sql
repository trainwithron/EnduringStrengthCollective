-- RELEASE BA (SWITCH THE ORGANIZATION-WALL REQUEST HEADER RULE ON; RUN AFTER RELEASE AZ AND THE CODE THAT SENDS THE HEADER): ONE paste. Steps 95 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 95: From now on a request that names a workspace sees and changes only that workspace's organization. Run it AFTER the code that sends the header is live and verified; to switch it off again, undo this step (one line).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BA (switch the organization-wall request header rule ON; run AFTER Release AZ and the code that sends the header), step 95: 0349 Switch the organization-wall request header rule ON
do $g95$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('step 94 is applied (the switch function exists)', to_regprocedure('public.org_wall_header_enabled()') is not null),
      ('0349 is not already applied (the rule is still off)', position('select true' in pg_get_functiondef(to_regprocedure('public.org_wall_header_enabled()'))) = 0)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BA (switch the organization-wall request header rule ON; run AFTER Release AZ and the code that sends the header), step 95 (0349) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g95$;

-- ====================================================================================================
-- migration 0349_org_wall_header_on.sql
-- ====================================================================================================

-- Release BA: switches the organization-wall request header rule ON (installed switched off by Release AZ). From here, a request that names a workspace sees and changes only that workspace's
-- organization on every table whose rows belong to a group. To switch it off again, put back "select false" (undo of this step).
create or replace function public.org_wall_header_enabled()
returns boolean
language sql
stable
set search_path = public
as $$ select true $$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 95 (0349)' as step, '0349 Switch the organization-wall request header rule ON' as what, not ((position('select true' in pg_get_functiondef(to_regprocedure('public.org_wall_header_enabled()'))) = 0)) as in_place
) as result order by step;
