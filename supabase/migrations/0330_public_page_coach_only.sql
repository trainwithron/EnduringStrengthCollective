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
