-- UNDO for step 76 (0330). Only if step 76 misbehaves. Puts both rules back to 'your own row' (without the coaching check).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "coach_booking_pages_coach_manage" on public.coach_booking_pages;
create policy "coach_booking_pages_coach_manage" on public.coach_booking_pages for all to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
drop policy if exists coach_sites_own on public.coach_sites;
create policy coach_sites_own on public.coach_sites for all to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
commit;
