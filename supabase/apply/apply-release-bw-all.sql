-- RELEASE BW (A REST CAN BE A RANGE SUCH AS 60-90; RUN AFTER RELEASE BV AND BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 117 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 117: Nothing changes on screen until the code that goes with it is live. Then a coach can give a rest as a range (60-90): it shows as 60-90 s, and the client's timer counts to the low end, tells them they can go, and keeps counting to the high end. A single time stays a single time. Run it AFTER step 116 (Release BV) and BEFORE the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BW (a rest can be a range such as 60-90; run AFTER Release BV and BEFORE the code that goes with it is live), step 117: 0367 A rest can be a range: a new empty column holds the high end (the low end stays where it is), and Duplicate copies it
do $g117$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0367 is not already applied (no rest high-end column yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercise_sets' and column_name = 'target_rest_max_seconds')),
      ('Release BV is applied (Duplicate knows about slots)', position('is_slot' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) > 0)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BW (a rest can be a range such as 60-90; run AFTER Release BV and BEFORE the code that goes with it is live), step 117 (0367) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g117$;

-- ====================================================================================================
-- migration 0367_rest_range.sql
-- ====================================================================================================

-- Release BW: a rest can be a range. target_rest_seconds stays the LOW end (and the whole value when the coach gives a single time); target_rest_max_seconds is the HIGH end, empty for a single time. The
-- rest timer counts to the low end and shows the client they are within the coach's range until the high end. Duplicate copies the new column; everything else in Duplicate is exactly as release BV left it.
alter table public.group_workout_exercise_sets add column if not exists target_rest_max_seconds numeric;
alter table public.group_workout_exercise_sets drop constraint if exists group_workout_exercise_sets_rest_range;
alter table public.group_workout_exercise_sets add constraint group_workout_exercise_sets_rest_range
  check (target_rest_max_seconds is null or (target_rest_seconds is not null and target_rest_max_seconds > target_rest_seconds and target_rest_max_seconds <= 1800));

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
        target_rest_seconds, target_rest_max_seconds, target_pace
      )
      select
        v_new_e, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_rest_max_seconds, target_pace
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
  select 'step 117 (0367)' as step, '0367 A rest can be a range: a new empty column holds the high end' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercise_sets' and column_name = 'target_rest_max_seconds'))) as in_place
) as result order by step;
