-- RELEASE AJ (A CLIENT IN A ONE-ON-ONE SPACE CAN NO LONGER READ THAT SPACE'S NO-CLIENT PROGRAMS; RUN AFTER RELEASE AG): ONE paste. Steps 78 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 78: A client in a one-on-one space no longer sees a no-client program in that space (for example a template the coach copied there). Programs made for the client, team and social groups, and everything a coach sees are unchanged. No program is changed or deleted.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AJ (a client in a one-on-one space can no longer read that space's no-client programs; run AFTER Release AG), step 78: 0332 In a one-on-one space a program with no client on it is the coach's template: the client can no longer read it (nor its workouts, exercises or sets)
do $g78$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0332 is not already applied (is_one_on_one_group does not exist yet)', to_regprocedure('public.is_one_on_one_group(uuid)') is null),
      ('programs can be removed from a profile (0328, step 74 applied)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'archived_at')),
      ('the two helper functions are the 0328 versions (they mention archived_at)', exists (select 1 from pg_proc where proname = 'is_ai_draft_program' and pronamespace = 'public'::regnamespace and prosrc like '%archived_at%') and exists (select 1 from pg_proc where proname = 'is_ai_draft_workout' and pronamespace = 'public'::regnamespace and prosrc like '%archived_at%'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AJ (a client in a one-on-one space can no longer read that space''s no-client programs; run AFTER Release AG), step 78 (0332) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g78$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 78 (0332)' as step, '0332 In a one-on-one space a program with no client on it is the coach''s template: the client can no longer read it' as what, not ((to_regprocedure('public.is_one_on_one_group(uuid)') is null)) as in_place
) as result order by step;
