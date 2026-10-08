-- STEP 55: 0310 The coach's own name for an exercise: one new optional column on the program's exercises (display_name), set only when a coach picks an exercise through their own alias, and the program copy (Assign to client, Duplicate) carries it across. The real exercise name is untouched, so history, personal records and progression keep matching; only what is shown uses the coach's name
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes until the code of the same release is live. After that, when a coach picks an exercise through one of their aliases (for example RFESS for the Bulgarian split squat) their program, the client's workout page and the logger show the coach's name, and every record and history lookup still uses the real exercise. Every existing exercise keeps showing exactly what it shows now.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'display_name'))) then
    raise exception 'Step 55 (0310) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0310_exercise_display_name.sql
-- ====================================================================================================

-- Release Q: the name a coach typed for an exercise, shown on their program, while it stays linked to the ONE real exercise underneath.
--  * group_workout_exercises.display_name: null for almost every row. It is set only when the coach picks an exercise through one of their own aliases ("RFESS" for the Bulgarian split
--    squat). exercise_name keeps holding the real exercise, so history, personal records, last time, progression, the AI builder and the library all keep matching on it; only what is SHOWN
--    (the builder, the client's workout page and the logger) uses display_name when there is one.
--  * public.duplicate_program (the atomic copy behind Assign to client, Duplicate and package auto-assign) carries display_name across, so a copied or assigned program keeps the coach's own names.
--    It is the LIVE function (identical to migration 0232, checked) with display_name added to the exercise copy; same security (invoker) and the same grants.
--  * A length limit so it stays a name. Nothing else changes: no policy, no function, no other table. A client reads it through the policies they already have on their program's exercises.
-- One new column, and one function replaced with the same text plus display_name. Re-runnable.

alter table public.group_workout_exercises add column if not exists display_name text;

do $q$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'group_workout_exercises_display_name_len' and conrelid = 'public.group_workout_exercises'::regclass
  ) then
    alter table public.group_workout_exercises
      add constraint group_workout_exercises_display_name_len check (display_name is null or char_length(btrim(display_name)) between 1 and 120);
  end if;
end
$q$;

comment on column public.group_workout_exercises.display_name is 'The coach''s own name for the exercise, shown instead of exercise_name; set only when picked through an alias. Every lookup (history, records, progression) still uses exercise_name.';

-- ---- the program copy keeps the coach's names ----
do $guard$
begin
  if to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is null then
    raise exception 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date) was not found, so the program copy cannot carry the coach''s names. NOTHING was changed.';
  end if;
end
$guard$;

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
    cover_image_path, ai_sequencing_notes
  )
  values (
    p_destination_group_id,
    case when p_client_name is not null and length(trim(p_client_name)) > 0
         then src.name || ' — ' || p_client_name else src.name end,
    src.description,
    v_by,
    p_athlete_id,
    true,
    coalesce(p_start_date, src.start_date),
    src.training_days,
    src.visibility_window,
    src.training_intent,
    case when p_destination_group_id = src.group_id then src.cover_image_path else null end,
    src.ai_sequencing_notes
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

revoke execute on function public.duplicate_program(uuid, uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.duplicate_program(uuid, uuid, uuid, uuid, text, date) to authenticated, service_role;

commit;
