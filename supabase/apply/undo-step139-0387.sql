-- UNDO for step 139 (0387). Only if step 139 misbehaves. Puts back the earlier challenge rule and removes the personal listing columns (coaches in listed organizations are then shown as before).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "challenge_participants_insert_self_or_coach" on public.challenge_participants;
create policy "challenge_participants_insert_self_or_coach" on public.challenge_participants for insert to authenticated with check (((profile_id = (select auth.uid())) and exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.status = 'active' and is_client_of_coach(c.coach_id))) or exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.coach_id = (select auth.uid())));
alter table public.profiles drop constraint if exists profiles_marketplace_display_name_length;
alter table public.profiles drop column if exists marketplace_display_name;
alter table public.profiles drop column if exists marketplace_listed;
commit;
