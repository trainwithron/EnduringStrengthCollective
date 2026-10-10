-- UNDO for step 74 (0328). Only if step 74 misbehaves. Puts the two helper functions and the programs read rule back as they were and drops the column (programs that were removed from a profile become visible again to their clients).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "programs_select_members" on public.programs;
create policy "programs_select_members" on public.programs for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)) and (is_group_coach(group_id) or (not ai_draft)));
create or replace function public.is_ai_draft_program(_program_id uuid) returns boolean language sql stable security definer set search_path = public as 'select coalesce((select p.ai_draft from public.programs p where p.id = _program_id), false)';
create or replace function public.is_ai_draft_workout(_workout_id uuid) returns boolean language sql stable security definer set search_path = public as 'select coalesce((select p.ai_draft from public.workouts w join public.programs p on p.id = w.program_id where w.id = _workout_id), false)';
alter table public.programs drop constraint if exists programs_archived_is_inactive;
alter table public.programs drop column if exists archived_at;
commit;
