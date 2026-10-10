-- UNDO for step 70 (0324). Only if step 70 misbehaves. Puts the copy function back exactly as it was and drops the draft flag and its guard (any draft programs stay, now inactive or active as they were saved).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy "exercise_progressions_select_members" on public.exercise_progressions;
create policy "exercise_progressions_select_members" on public.exercise_progressions for select to authenticated using (public.is_group_member(group_id));
drop policy "workout_notes_select_members" on public.workout_notes;
create policy "workout_notes_select_members" on public.workout_notes for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)));
drop policy "workouts_select_members" on public.workouts;
create policy "workouts_select_members" on public.workouts for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)));
drop policy "programs_select_members" on public.programs;
create policy "programs_select_members" on public.programs for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)));
create or replace function public.is_workout_visible_to_athlete(target_workout_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_program_id uuid;
  v_week_number int;
  v_day_index int;
  v_start_date date;
  v_training_days smallint[];
  v_visibility_window text;
  v_ordinal int;
  v_cursor date;
  v_matched int := 0;
  v_scheduled_date date;
  v_window_days int;
begin
  select w.program_id, w.week_number, w.day_index
  into v_program_id, v_week_number, v_day_index
  from public.workouts w where w.id = target_workout_id;

  if v_program_id is null then
    return true;
  end if;

  select p.start_date, p.training_days, coalesce(p.visibility_window, 'day')
  into v_start_date, v_training_days, v_visibility_window
  from public.programs p where p.id = v_program_id;

  if v_start_date is null or v_training_days is null or array_length(v_training_days, 1) is null then
    return true;
  end if;

  if v_visibility_window = 'full' then
    return true;
  end if;

  select count(*) into v_ordinal
  from public.workouts w2
  where w2.program_id = v_program_id
    and (w2.week_number, w2.day_index) <= (v_week_number, v_day_index);

  v_cursor := v_start_date;
  while v_matched < v_ordinal loop
    if extract(dow from v_cursor)::int = any(v_training_days) then
      v_matched := v_matched + 1;
      exit when v_matched = v_ordinal;
    end if;
    v_cursor := v_cursor + 1;
  end loop;
  v_scheduled_date := v_cursor;

  v_window_days := case v_visibility_window
    when 'week' then 7
    when 'month' then 30
    else 0
  end;

  return v_scheduled_date <= (current_date + v_window_days);
end;
$$;
drop function if exists public.is_ai_draft_workout(uuid);
drop function if exists public.is_ai_draft_program(uuid);
drop trigger if exists programs_guard_ai_draft on public.programs;
drop function if exists public.guard_ai_draft_not_active();
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
    cover_image_path, ai_sequencing_notes, source_program_id
  )
  values (
    p_destination_group_id,
    v_name,
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
alter table public.programs drop column if exists ai_draft;
commit;
