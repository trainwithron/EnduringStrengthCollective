-- UNDO for step 85 (0339). Only if step 85 misbehaves. Puts back the earlier single rule (an athlete can write their own cards, with no check on the photo or group).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "transformation_cards_insert_own" on public.transformation_cards;
drop policy if exists "transformation_cards_update_own" on public.transformation_cards;
drop policy if exists "transformation_cards_delete_own" on public.transformation_cards;
drop policy if exists "transformation_cards_write_own" on public.transformation_cards;
create policy "transformation_cards_write_own" on public.transformation_cards for all to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
commit;
