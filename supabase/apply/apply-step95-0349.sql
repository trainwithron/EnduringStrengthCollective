-- STEP 95: 0349 Switch the organization-wall request header rule ON
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: From now on a request that names a workspace sees and changes only that workspace's organization. Run it AFTER the code that sends the header is live and verified; to switch it off again, undo this step (one line).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((position('select true' in pg_get_functiondef(to_regprocedure('public.org_wall_header_enabled()'))) = 0)) then
    raise exception 'Step 95 (0349) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
