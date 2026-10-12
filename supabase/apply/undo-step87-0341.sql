-- UNDO for step 87 (0341). Only if step 87 misbehaves (for example the packages screen can no longer save). Puts back the three write rules exactly as they were.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
create policy "coach_packages_insert_coach" on public.coach_packages for insert to authenticated with check (coach_id = (select auth.uid()));
create policy "coach_packages_update_coach" on public.coach_packages for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "coach_packages_delete_coach" on public.coach_packages for delete to authenticated using (coach_id = (select auth.uid()));
commit;
