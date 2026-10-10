-- "Remove from this profile": a coach takes a program copy off a client's profile WITHOUT deleting it. The copy, its workouts and every logged set stay in the database exactly as they
-- were; the client simply stops seeing it, and a coach can put it back.
--
--   * programs.archived_at (null = not removed). A removed program must be inactive: the database refuses an active archived program, so putting one back never silently makes it the
--     client's current program (the coach makes it active on purpose).
--   * A removed program is hidden from members who are not coaches of the group in exactly the way an unsigned AI draft is (0324): the program, its workouts, exercises, sets, notes and
--     progressions. That reuses the existing hiding by widening the two helper functions (which still carry their 0324 names) and the programs read rule. Coaches read it as before.
-- Requires 0324.
alter table public.programs add column archived_at timestamptz;
alter table public.programs add constraint programs_archived_is_inactive check (archived_at is null or is_active = false);

create or replace function public.is_ai_draft_program(_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.ai_draft or p.archived_at is not null) from public.programs p where p.id = _program_id), false);
$$;

create or replace function public.is_ai_draft_workout(_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.ai_draft or p.archived_at is not null) from public.workouts w join public.programs p on p.id = w.program_id where w.id = _workout_id), false);
$$;

drop policy "programs_select_members" on public.programs;
create policy "programs_select_members" on public.programs for select
  to authenticated using (
    is_group_member(group_id)
    and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id))
    and (is_group_coach(group_id) or (not ai_draft and archived_at is null))
  );
