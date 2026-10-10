-- STEP 76: 0330 Only a real coach can have a public booking page or a public website (the row-security rule for changing them now also requires coaching a group)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for anyone who has a page (nobody does today). From now on an account that coaches no group cannot create or change a public page.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage' and with_check like '%group_memberships%'))) then
    raise exception 'Step 76 (0330) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
