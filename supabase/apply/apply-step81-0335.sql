-- STEP 81: 0335 Assigning a program that belongs to no client to ONE client attaches it to that client (no copy is left behind)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes by itself. After the app update, assigning a template (a program with no client on it, nobody has used) to one client makes it that client's program instead of making a copy and leaving the original in the library. Any other assignment copies, as before.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is null)) then
    raise exception 'Step 81 (0335) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0335_assign_program_to_client.sql
-- ====================================================================================================

-- Release AM: assigning a program that belongs to NO client yet to ONE client makes it THAT client's program (it is attached: no copy is made, nothing is left behind in the library).
-- Before, "Assign program" always made an independent copy, so the coach saw two of everything. Ron: "I don't need two immediately. I can take the client's program and then duplicate it or
-- use it as a template for others."
--
-- public.assign_program_to_client(program, destination group, client, client name, start date) returns (assigned_program_id, was_attached):
--   ATTACHED (was_attached = true) when the program has no client on it AND nothing else depends on it: it is not an unsigned AI draft, it is either a template in a one-on-one space (which no
--     client can read) or an inactive library program (never the shared program a team is following), and nobody has logged, been scheduled or been assigned any of its workouts, and no
--     challenge points at it, and it is not the program a coach package hands to each buyer (coach_packages.default_program_id), and no client has a personal exercise override on it. Then, in ONE step: the program, its workouts, exercises, notes and progression rules move into the client's space (the destination group), the client's id goes
--     on the program, workouts, exercises and notes, and the program is made active (the client is assigned it), which also sends the client the usual "your coach assigned you a new
--     program" notice. Sets hang off exercises and need no change.
--   COPIED (was_attached = false) in every other case: it simply calls duplicate_program, exactly as assigning always did (the original stays where it is). That includes a program that already
--     belongs to a client, a team's active shared program, a program someone has logged against, and an unsigned draft.
-- It runs as the signed-in coach (row security applies exactly as for duplicate_program), so a program or group the coach does not coach is refused. All or nothing.
-- New function only; nothing existing is changed or removed. Requires 0332 and 0333 (the one-on-one rules).

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
  select g.group_kind into v_kind from public.groups g where g.id = src.group_id;

  if src.athlete_id is null
     and not src.ai_draft
     and src.archived_at is null
     and (v_kind = 'one_on_one' or src.is_active = false)
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
