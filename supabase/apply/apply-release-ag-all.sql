-- RELEASE AG (REMOVE A PROGRAM FROM A CLIENT'S PROFILE WITHOUT DELETING IT; RUN AFTER RELEASE AC): ONE paste. Steps 74 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 74: Nothing changes for anyone. One column is added. No program is hidden until a coach removes one from a client's profile.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AG (remove a program from a client's profile without deleting it; run AFTER Release AC), step 74: 0328 Remove a program from a client's profile without deleting it: programs.archived_at; a removed program is inactive and hidden from the client like an unsigned AI draft
do $g74$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0328 is not already applied (programs has no archived_at column yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'archived_at')),
      ('the AI draft flag exists (0324, step 70)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'ai_draft'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AG (remove a program from a client''s profile without deleting it; run AFTER Release AC), step 74 (0328) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g74$;

-- ====================================================================================================
-- migration 0328_program_archive.sql
-- ====================================================================================================

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

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 74 (0328)' as step, '0328 Remove a program from a client''s profile without deleting it: programs.archived_at' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'archived_at'))) as in_place
) as result order by step;
