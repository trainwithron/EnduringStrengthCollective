-- FIX 2 (THE FIRST PERSON A PROGRAM IS ASSIGNED TO GETS THE ORIGINAL; REPLACES ONE FUNCTION): ONE paste. Steps 176 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 176: Nothing changes on screen until the FIX 2 code is live (safe either order). Then assigning a program from the library to its first person hands them the program itself; the next person gets their own copy, and the program list shows who has it.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== FIX 2 (the first person a program is assigned to gets the original; replaces one function), step 176: 0424 FIX 2: the first person a program is assigned to gets the original, later people get a copy (replaces one function)
do $g176$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0424 is not already applied (the function does not yet check for copies)', not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') and position('c.source_program_id = src.id' in p.prosrc) > 0)),
      ('the function is exactly the text this replaces (0337)', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'ea532ac6f03eb202b54e26147fec00df' from pg_proc p where p.oid = to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)')), false)),
      ('the slot column it reads exists', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'is_slot') = 1),
      ('the copy column it reads exists', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'source_program_id') = 1)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'FIX 2 (the first person a program is assigned to gets the original; replaces one function), step 176 (0424) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g176$;

-- ====================================================================================================
-- migration 0424_first_assignee_gets_the_original.sql
-- ====================================================================================================

-- FIX 2: the first person a program is assigned to gets the ORIGINAL; everyone after gets their own copy (Ron, asked four times: "first person gets the original").
-- Same function as 0337 (word for word: every check, the move of workouts, exercises, notes and progressions, is_active and the start date), with the attach condition widened from "a one-on-one
-- space or an inactive program" to also cover an active program in a group with no clients yet, and narrowed by two rules:
--   * not once anyone has a copy of it (then it is the template the copies came from, and stays one);
--   * never a template with slots (a slot is filled per client, so a template is always copied).
-- Requires 0337. Replaces one function; nothing else changes.
create or replace function public.assign_program_to_client(
  p_program_id uuid,
  p_destination_group_id uuid,
  p_athlete_id uuid,
  p_client_name text default null,
  p_start_date date default null
)
returns table (assigned_program_id uuid, was_attached boolean)
language plpgsql
set search_path = public
as $$
declare
  src public.programs%rowtype;
  v_kind text;
  v_src_org uuid;
  v_dest_org uuid;
  v_new uuid;
begin
  if p_athlete_id is null then
    raise exception 'A client is required.';
  end if;
  -- The client must be an athlete in the group the program is going to (a loose id would otherwise get the program and the "assigned" notice).
  if not exists (select 1 from public.group_memberships gm where gm.group_id = p_destination_group_id and gm.profile_id = p_athlete_id and gm.role = 'athlete') then
    raise exception 'That client is not in that group.';
  end if;

  select * into src from public.programs where id = p_program_id for update;
  if not found then
    raise exception 'Source program not found.';
  end if;
  select g.group_kind, g.organization_id into v_kind, v_src_org from public.groups g where g.id = src.group_id;
  select g.organization_id into v_dest_org from public.groups g where g.id = p_destination_group_id;

  if src.athlete_id is null
     and v_src_org is not distinct from v_dest_org
     and not src.ai_draft
     and src.archived_at is null
     and (v_kind = 'one_on_one' or src.is_active = false or not exists (select 1 from public.group_memberships gm where gm.group_id = src.group_id and gm.role = 'athlete'))
     and not exists (select 1 from public.programs c where c.source_program_id = src.id and c.archived_at is null)
     and not exists (select 1 from public.workouts w join public.group_workout_exercises e on e.workout_id = w.id where w.program_id = src.id and e.is_slot)
     and not exists (select 1 from public.workouts w join public.workout_logs l on l.workout_id = w.id where w.program_id = src.id)
     and not exists (select 1 from public.workouts w join public.athlete_sessions s on s.workout_id = w.id where w.program_id = src.id)
     and not exists (select 1 from public.workouts w join public.workout_assignments a on a.workout_id = w.id where w.program_id = src.id)
     and not exists (select 1 from public.challenges c where c.program_id = src.id)
     and not exists (select 1 from public.coach_packages cp where cp.default_program_id = src.id)
     and not exists (select 1 from public.workouts w join public.group_workout_exercises e on e.workout_id = w.id join public.athlete_exercise_overrides o on o.group_workout_exercise_id = e.id where w.program_id = src.id)
  then
    update public.programs
       set athlete_id = p_athlete_id,
           group_id = p_destination_group_id,
           is_active = true,
           start_date = coalesce(p_start_date, start_date)
     where id = src.id;
    update public.workouts set group_id = p_destination_group_id, athlete_id = p_athlete_id where program_id = src.id;
    update public.group_workout_exercises e set group_id = p_destination_group_id, athlete_id = p_athlete_id
      from public.workouts w where e.workout_id = w.id and w.program_id = src.id;
    update public.workout_notes n set group_id = p_destination_group_id, athlete_id = p_athlete_id
      from public.workouts w where n.workout_id = w.id and w.program_id = src.id;
    update public.exercise_progressions set group_id = p_destination_group_id where program_id = src.id;
    return query select src.id, true;
    return;
  end if;

  v_new := public.duplicate_program(p_program_id, p_destination_group_id, null, p_athlete_id, p_client_name, p_start_date);
  return query select v_new, false;
end;
$$;
revoke execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) to authenticated, service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 176 (0424)' as step, '0424 FIX 2: the first person a program is assigned to gets the original' as what, not ((not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') and position('c.source_program_id = src.id' in p.prosrc) > 0))) as in_place
) as result order by step;
