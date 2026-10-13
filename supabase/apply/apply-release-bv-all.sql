-- RELEASE BV (TEMPLATE SLOTS SURVIVE DUPLICATE; A PROGRAM WITH A SLOT CANNOT BE ASSIGNED TO A CLIENT; RUN AFTER RELEASE BU AND BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 116 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 116: Nothing changes on screen until the code that goes with it is live. Then a template with slots can be duplicated and kept in the library, and assigning one to a client says it cannot be assigned yet. Run it AFTER step 115 (Release BU) and BEFORE the code that goes with it is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BV (template slots survive Duplicate; a program with a slot cannot be assigned to a client; run AFTER Release BU and BEFORE the code that goes with it is live), step 116: 0366 Template slots survive Duplicate, and a program that still has a slot cannot be given to a client (the duplicate-program function is replaced; the two flags added by step 115 may be empty so the old restore scripts still work)
do $g116$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0366 is not already applied (the duplicate-program function does not know about slots yet)', position('is_slot' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) = 0),
      ('Release BU is applied (the slot columns exist)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'is_slot'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BV (template slots survive Duplicate; a program with a slot cannot be assigned to a client; run AFTER Release BU and BEFORE the code that goes with it is live), step 116 (0366) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g116$;

-- ====================================================================================================
-- migration 0366_template_slots_survive_duplicate.sql
-- ====================================================================================================

-- Release BV: template slots survive Duplicate, and a client is never given a program that still has slots. A slot ("Hinge, unilateral, class A") is a placeholder the coach fills in when assigning; a copy that
-- is not for a client (same group, another group, another organization) keeps its slots as they are. A copy for one client of a program that still has a slot is refused, so no path (assigning, a package, Assign to
-- Myself) can hand anyone a placeholder. Everything else is exactly as release BC left it.
-- The two flags from 0365 may be empty (they still default to false): the older restore and merge scripts put rows back with an explicit empty value for a column they never knew about, which a NOT NULL
-- column refuses. Code and database treat empty as "no" (not one-sided, not a slot).
alter table public.movement_pattern_exercises alter column is_unilateral drop not null;
alter table public.group_workout_exercises alter column is_slot drop not null;

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
  v_name text;
  v_tail text := ' ' || chr(8212) || ' ';
begin
  if v_by is null then
    raise exception 'created_by is required';
  end if;

  if p_athlete_id is not null and exists (
    select 1
    from public.group_workout_exercises g
    join public.workouts wk on wk.id = g.workout_id
    where wk.program_id = p_source_program_id and g.is_slot
  ) then
    raise exception 'This template has slots. Choosing its exercises for a client comes next, so it can''t be assigned yet.';
  end if;

  select * into src from public.programs where id = p_source_program_id;
  if not found then
    raise exception 'Source program not found.';
  end if;

  -- The copy's name. A copy for a client is "Program - Client". When the source is itself a client's copy ("Program - Alice") its old client tail is dropped first, so assigning it to Bob gives
  -- "Program - Bob", not "Program - Alice - Bob"; and a name that already ends with this client's name is left as it is, so assigning twice never repeats it.
  v_name := src.name;
  if p_client_name is not null and length(trim(p_client_name)) > 0 then
    if right(v_name, length(v_tail || trim(p_client_name))) <> v_tail || trim(p_client_name) then
      if src.athlete_id is not null then
        v_name := regexp_replace(v_name, ' ' || chr(8212) || ' [^' || chr(8212) || ']*$', '');
      end if;
      v_name := v_name || v_tail || trim(p_client_name);
    end if;
  end if;

  insert into public.programs (
    group_id, name, description, created_by, athlete_id, is_active,
    start_date, training_days, visibility_window, training_intent,
    cover_image_path, ai_sequencing_notes, source_program_id, ai_draft
  )
  values (
    p_destination_group_id,
    v_name,
    src.description,
    v_by,
    p_athlete_id,
    -- A plain duplicate (no client) is an unassigned LIBRARY program: nothing a client or a team sees until the coach assigns it or makes it active. A copy for one client (an assignment) is live as before.
    case when p_athlete_id is null then false else not src.ai_draft end,
    coalesce(p_start_date, src.start_date),
    src.training_days,
    src.visibility_window,
    src.training_intent,
    case when p_destination_group_id = src.group_id then src.cover_image_path else null end,
    src.ai_sequencing_notes,
    p_source_program_id,
    src.ai_draft
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
        workout_id, group_id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes, display_name,
        is_slot, slot_side, slot_tier
      )
      values (
        v_new_w, p_destination_group_id, e.exercise_name, e.exercise_order,
        e.movement_pattern_id, e.tracked_fields, e.notes, e.display_name,
        e.is_slot, e.slot_side, e.slot_tier
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

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 116 (0366)' as step, '0366 Template slots survive Duplicate' as what, not ((position('is_slot' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) = 0)) as in_place
) as result order by step;
