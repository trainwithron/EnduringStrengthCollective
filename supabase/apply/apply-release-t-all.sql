-- RELEASE T (A PROGRAM COPY REMEMBERS ITS SOURCE; A PACKAGE CAN OPEN A GROUP): ONE paste. Steps 61, 62 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 61: Nothing visible changes. Programs made before this keep no link (nothing is matched or renamed). From now on every copy (Assign to client, Duplicate, a package that carries a program) records the program it came from, and the program's label at the top of the builder lists the clients assigned to it.
-- AFTER STEP 62: Nothing changes for existing packages (none has a group). A coach can now pick a group on a package; a client who buys or is given it joins that group and sees its programs. If a subscription ends, the group access ends; the program copy stays and sessions follow their own expiry rule.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release T (a program copy remembers its source; a package can open a group), step 61: 0316 A program copy remembers which program it was copied from: one optional column (programs.source_program_id) and the copy function now stores it, so the builder can list the clients who hold a copy of a program
do $g61$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('the program copy function exists', to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is not null),
      ('0316 is not already applied (programs has no source_program_id yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'source_program_id'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release T (a program copy remembers its source; a package can open a group), step 61 (0316) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g61$;

-- ====================================================================================================
-- migration 0316_program_source_link.sql
-- ====================================================================================================

-- Release T, part 1: a program copy remembers which program it was copied from (Ron: the program's label at the top of the builder opens "Clients assigned to this program").
--
--   * programs.source_program_id: nullable, points at the program a copy was made from; set to null if the original is ever deleted (the copy is untouched). Nothing else about a
--     copy changes: it stays a fully independent program. Existing programs are NOT touched or matched: only copies made from now on carry the link.
--   * duplicate_program: the 0310 text plus storing the source in that column. Everything that copies a program (Assign to client, Duplicate, a package that carries a program) goes
--     through this one function, so they all record it.
-- The dash in a client copy's name ("Program - Ann") is written as chr(8212), not typed, so it survives being pasted into the SQL editor (a typed dash was being saved as garbled characters).
-- Re-runnable.

alter table public.programs add column if not exists source_program_id uuid references public.programs(id) on delete set null;
create index if not exists programs_source_program_id_idx on public.programs (source_program_id) where source_program_id is not null;

create or replace function public.duplicate_program(
  p_source_program_id uuid,
  p_destination_group_id uuid,
  p_created_by uuid default null,
  p_athlete_id uuid default null,
  p_client_name text default null,
  p_start_date date default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  src public.programs%rowtype;
  v_by uuid := coalesce(p_created_by, auth.uid());
  v_new uuid;
  w record;
  e record;
  v_new_w uuid;
  v_new_e uuid;
begin
  if v_by is null then
    raise exception 'created_by is required';
  end if;

  select * into src from public.programs where id = p_source_program_id;
  if not found then
    raise exception 'Source program not found.';
  end if;

  insert into public.programs (
    group_id, name, description, created_by, athlete_id, is_active,
    start_date, training_days, visibility_window, training_intent,
    cover_image_path, ai_sequencing_notes, source_program_id
  )
  values (
    p_destination_group_id,
    case when p_client_name is not null and length(trim(p_client_name)) > 0
         then src.name || ' ' || chr(8212) || ' ' || p_client_name else src.name end,
    src.description,
    v_by,
    p_athlete_id,
    true,
    coalesce(p_start_date, src.start_date),
    src.training_days,
    src.visibility_window,
    src.training_intent,
    case when p_destination_group_id = src.group_id then src.cover_image_path else null end,
    src.ai_sequencing_notes,
    p_source_program_id
  )
  returning id into v_new;

  insert into public.exercise_progressions (
    program_id, group_id, exercise_name, model, config, tier_label, created_by
  )
  select v_new, p_destination_group_id, exercise_name, model, config, tier_label, v_by
  from public.exercise_progressions
  where program_id = p_source_program_id;

  for w in
    select * from public.workouts
    where program_id = p_source_program_id
    order by week_number, day_index
  loop
    insert into public.workouts (program_id, group_id, title, week_number, day_index, notes)
    values (v_new, p_destination_group_id, w.title, w.week_number, w.day_index, w.notes)
    returning id into v_new_w;

    for e in
      select * from public.group_workout_exercises
      where workout_id = w.id
      order by exercise_order
    loop
      insert into public.group_workout_exercises (
        workout_id, group_id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes, display_name
      )
      values (
        v_new_w, p_destination_group_id, e.exercise_name, e.exercise_order,
        e.movement_pattern_id, e.tracked_fields, e.notes, e.display_name
      )
      returning id into v_new_e;

      insert into public.group_workout_exercise_sets (
        group_workout_exercise_id, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_pace
      )
      select
        v_new_e, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_pace
      from public.group_workout_exercise_sets
      where group_workout_exercise_id = e.id
      order by set_order;
    end loop;

    insert into public.workout_notes (workout_id, group_id, body, position, created_by)
    select v_new_w, p_destination_group_id, body, position, v_by
    from public.workout_notes
    where workout_id = w.id
    order by position;
  end loop;

  return v_new;
end;
$$;

revoke execute on function public.duplicate_program(uuid, uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.duplicate_program(uuid, uuid, uuid, uuid, text, date) to authenticated, service_role;

-- ===== Release T (a program copy remembers its source; a package can open a group), step 62: 0317 A package can include access to a group: one optional column on packages (the group it opens) and one server-only record of the access a package gave, so it can end cleanly when a subscription lapses
do $g62$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('coach_packages exists', to_regclass('public.coach_packages') is not null),
      ('0317 is not already applied (packages have no group_access_group_id yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'group_access_group_id'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release T (a program copy remembers its source; a package can open a group), step 62 (0317) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g62$;

-- ====================================================================================================
-- migration 0317_package_group_access.sql
-- ====================================================================================================

-- Release T, part 2: a package can include ACCESS TO A GROUP (Ron). Buying or being given the package makes the client a member of that group, so they see its programs.
--
--   * coach_packages.group_access_group_id: nullable, the group the package opens (a group the coach coaches; checked by the server). Existing packages have none and behave as before.
--     Set to null if that group is ever deleted.
--   * package_group_access: one row per (client, group, package) recording the access a package gave, and whether the package is what made them a member (created_membership). It is how
--     the access can end cleanly when a subscription lapses without removing anyone who was already in the group by other means. Server only: no signed-in user can read or write it.
-- Nothing else changes. Re-runnable.

alter table public.coach_packages add column if not exists group_access_group_id uuid references public.groups(id) on delete set null;

create table if not exists public.package_group_access (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  coach_package_id uuid not null references public.coach_packages(id) on delete cascade,
  created_membership boolean not null default false,
  granted_at timestamptz not null default now(),
  primary key (athlete_id, group_id, coach_package_id)
);
create index if not exists package_group_access_package_idx on public.package_group_access (coach_package_id);
alter table public.package_group_access enable row level security;
revoke all on public.package_group_access from anon, authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 61 (0316)' as step, '0316 A program copy remembers which program it was copied from: one optional column' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'source_program_id'))) as in_place
  union all
  select 'step 62 (0317)' as step, '0317 A package can include access to a group: one optional column on packages' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'group_access_group_id'))) as in_place
) as result order by step;
