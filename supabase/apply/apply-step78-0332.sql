-- STEP 78: 0332 In a one-on-one space a program with no client on it is the coach's template: the client can no longer read it (nor its workouts, exercises or sets)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: A client in a one-on-one space no longer sees a no-client program in that space (for example a template the coach copied there). Programs made for the client, team and social groups, and everything a coach sees are unchanged. No program is changed or deleted.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.is_one_on_one_group(uuid)') is null)) then
    raise exception 'Step 78 (0332) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0332_one_on_one_private_programs.sql
-- ====================================================================================================

-- In a one-on-one space (a coach and ONE client) a program with no client on it is the coach's own template, never something the client follows. Before, the database let a client
-- in such a space read every no-client program there (and its workouts, exercises, sets, notes and progressions), so a template a coach copied or built there, possibly named after
-- ANOTHER client, was readable by this client. Now the client cannot read it. A team or social group is unchanged: a no-client program there is still the group's shared program.
-- Coaches (and the organization's admins, through the read rules they already have) are unchanged, and a program made FOR the client (athlete_id = the client) is unchanged.
--
-- This reuses the hiding already built for an unsigned AI draft and a program removed from a profile (0324, 0328): the two helper functions (which keep their old names) and the
-- programs read rule now also hide a no-client program in a one-on-one space from members who are not coaches of the group. The exercises and sets already ask the same helper
-- (through is_workout_visible_to_athlete). Requires 0324 and 0328.

create or replace function public.is_one_on_one_group(_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select g.group_kind = 'one_on_one' from public.groups g where g.id = _group_id), false);
$$;
revoke all on function public.is_one_on_one_group(uuid) from public, anon;
grant execute on function public.is_one_on_one_group(uuid) to authenticated;

create or replace function public.is_ai_draft_program(_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.ai_draft or p.archived_at is not null or (p.athlete_id is null and public.is_one_on_one_group(p.group_id))) from public.programs p where p.id = _program_id), false);
$$;

create or replace function public.is_ai_draft_workout(_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.ai_draft or p.archived_at is not null or (p.athlete_id is null and public.is_one_on_one_group(p.group_id))) from public.workouts w join public.programs p on p.id = w.program_id where w.id = _workout_id), false);
$$;

drop policy "programs_select_members" on public.programs;
create policy "programs_select_members" on public.programs for select
  to authenticated using (
    is_group_member(group_id)
    and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id))
    and (is_group_coach(group_id) or (not ai_draft and archived_at is null and (athlete_id is not null or not public.is_one_on_one_group(group_id))))
  );

commit;
