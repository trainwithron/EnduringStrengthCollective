-- UNDO for step 78 (0332). Only if step 78 misbehaves. Puts the two helper functions and the programs read rule back as they were after step 74 (clients in a one-on-one space can read no-client programs there again). It does not un-attach Karina's and Johann's programs from their clients; that is harmless.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "programs_select_members" on public.programs;
create policy "programs_select_members" on public.programs for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)) and (is_group_coach(group_id) or (not ai_draft and archived_at is null)));
create or replace function public.is_ai_draft_program(_program_id uuid) returns boolean language sql stable security definer set search_path = public as 'select coalesce((select (p.ai_draft or p.archived_at is not null) from public.programs p where p.id = _program_id), false)';
create or replace function public.is_ai_draft_workout(_workout_id uuid) returns boolean language sql stable security definer set search_path = public as 'select coalesce((select (p.ai_draft or p.archived_at is not null) from public.workouts w join public.programs p on p.id = w.program_id where w.id = _workout_id), false)';
drop function if exists public.is_one_on_one_group(uuid);
commit;
