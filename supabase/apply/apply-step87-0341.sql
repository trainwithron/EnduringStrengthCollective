-- STEP 87: 0341 A coach package can only be created, changed or removed by the server (a client could file their own package with thousands of sessions and pay for a cheap one)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for normal use: the packages screen already saves through the server. Nobody can write the packages table straight from a browser any more. Reading is unchanged and existing packages are untouched.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_insert_coach'))) then
    raise exception 'Step 87 (0341) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0341_coach_packages_server_only.sql
-- ====================================================================================================

-- Release AS: a coach package can only be written by the server.
-- Before, three policies let ANY signed-in person insert, update or delete coach_packages rows as long as coach_id was their own id (they did not have to coach the group named on the row). A client could
-- file a package of their own in their coach's group with 1000 sessions and the price id of a cheap real pack, pay for the cheap one, and be granted 1000 sessions; a coach could re-point a package at
-- another organization's group. The app never writes this table from the browser: the packages route (app/api/coach/packages/route.ts) uses the server's own access, which these policies never applied to.
-- Reading is unchanged (a coach sees their own packages; a client sees the active public ones of their group). Existing packages are not touched.
drop policy if exists "coach_packages_insert_coach" on public.coach_packages;
drop policy if exists "coach_packages_update_coach" on public.coach_packages;
drop policy if exists "coach_packages_delete_coach" on public.coach_packages;

commit;
