-- RELEASE AH (ONLY A REAL COACH CAN HAVE A PUBLIC BOOKING PAGE OR WEBSITE): ONE paste. Steps 76 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 76: Nothing changes for anyone who has a page (nobody does today). From now on an account that coaches no group cannot create or change a public page.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AH (only a real coach can have a public booking page or website), step 76: 0330 Only a real coach can have a public booking page or a public website (the row-security rule for changing them now also requires coaching a group)
do $g76$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0330 is not already applied (the booking page rule does not mention coaching yet)', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage' and with_check like '%group_memberships%')),
      ('both public page tables exist (0261, 0321)', to_regclass('public.coach_booking_pages') is not null and to_regclass('public.coach_sites') is not null),
      ('both rules are the expected ones (your own row only)', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_sites' and policyname = 'coach_sites_own'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AH (only a real coach can have a public booking page or website), step 76 (0330) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g76$;

-- ====================================================================================================
-- migration 0330_public_page_coach_only.sql
-- ====================================================================================================

-- Only a real coach can have a public booking page or a public website. Until now the row-security rule only checked that the row belonged to the signed-in person, so a client (or
-- anyone with an account) could create a coach_booking_pages / coach_sites row of their own and publish a page under their name. The rule for CHANGING these rows (the check) now also
-- requires that the person coaches at least one group; reading and deleting your own row is unchanged. Nobody has such a page today (both tables are empty), so nothing is affected.
drop policy "coach_booking_pages_coach_manage" on public.coach_booking_pages;
create policy "coach_booking_pages_coach_manage" on public.coach_booking_pages for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')
  );

drop policy "coach_sites_own" on public.coach_sites;
create policy "coach_sites_own" on public.coach_sites for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')
  );

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 76 (0330)' as step, '0330 Only a real coach can have a public booking page or a public website' as what, not ((not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage' and with_check like '%group_memberships%'))) as in_place
) as result order by step;
