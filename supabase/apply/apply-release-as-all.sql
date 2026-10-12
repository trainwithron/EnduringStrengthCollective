-- RELEASE AS (COACH PACKAGES CAN ONLY BE WRITTEN BY THE SERVER; RUN ANY TIME): ONE paste. Steps 87 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 87: Nothing changes for normal use: the packages screen already saves through the server. Nobody can write the packages table straight from a browser any more. Reading is unchanged and existing packages are untouched.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AS (coach packages can only be written by the server; run any time), step 87: 0341 A coach package can only be created, changed or removed by the server (a client could file their own package with thousands of sessions and pay for a cheap one)
do $g87$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0341 is not already applied (the old write rules are still there)', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_insert_coach')),
      ('the update and delete rules are still there too', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_update_coach') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_delete_coach')),
      ('the packages table has its group and session columns', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'group_id') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'sessions_granted'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AS (coach packages can only be written by the server; run any time), step 87 (0341) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g87$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 87 (0341)' as step, '0341 A coach package can only be created' as what, not ((exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_insert_coach'))) as in_place
) as result order by step;
