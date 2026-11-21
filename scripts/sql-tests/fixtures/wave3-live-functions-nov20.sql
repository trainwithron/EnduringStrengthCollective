-- The LIVE public.duplicate_program (migration 0460's state, body md5 4517cdbe856943daf1a925820a0531a5) and public.notice_kind_of (0459's, body md5 with LF line ends 503b0e97bd7a2e6c37c1ddb47d5f5fcd)
-- on Nov 20 2026, each checked against live by md5 (SELECT md5(replace(prosrc, E'\r\n', E'\n'))). Generated, not typed.
CREATE OR REPLACE FUNCTION public.duplicate_program(p_source_program_id uuid, p_destination_group_id uuid, p_created_by uuid DEFAULT NULL::uuid, p_athlete_id uuid DEFAULT NULL::uuid, p_client_name text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    program_id, group_id, exercise_name, model, config, tier_label, slot, created_by
  )
  select v_new, p_destination_group_id, exercise_name, model, config, tier_label, slot, v_by
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
        is_slot, slot_side, slot_tier, progression_slot, superset_next
      )
      values (
        v_new_w, p_destination_group_id, e.exercise_name, e.exercise_order,
        e.movement_pattern_id, e.tracked_fields, e.notes, e.display_name,
        e.is_slot, e.slot_side, e.slot_tier, e.progression_slot, e.superset_next
      )
      returning id into v_new_e;

      insert into public.group_workout_exercise_sets (
        group_workout_exercise_id, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_rest_max_seconds, target_pace, set_type, target_pct_max
      )
      select
        v_new_e, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_rest_max_seconds, target_pace, set_type, target_pct_max
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
$function$;

CREATE OR REPLACE FUNCTION public.notice_kind_of(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_type
    when 'booking_request' then 'bookings'
    when 'late_change' then 'bookings'
    when 'waitlist_slot_offered' then 'bookings'
    when 'recurring_booking_conflict' then 'bookings'
    when 'schedule_request' then 'bookings'
    when 'schedule_applied' then 'bookings'
    when 'schedule_resumed' then 'bookings'
    when 'request_decision' then 'bookings'
    when 'trainer_dispatch_offer' then 'bookings'
    when 'trainer_dispatch_question' then 'bookings'
    when 'direct_message' then 'messages'
    when 'comment' then 'messages'
    when 'goal_proposed' then 'client_activity'
    when 'goal_answered' then 'client_activity'
    when 'meal_plan_try' then 'client_activity'
    when 'nutrition_allergies_updated' then 'client_activity'
    when 'nutrition_baseline_ready' then 'client_activity'
    when 'nutrition_preferences_changed' then 'client_activity'
    when 'nutrition_prompt_answered' then 'client_activity'
    when 'nutrition_target_changed' then 'client_activity'
    when 'weekly_checkin' then 'client_activity'
    when 'milestone_celebration' then 'milestones'
    when 'pr_promotion' then 'milestones'
    when 'client_request' then 'requests'
    when 'session_pattern_note' then 'session_notes'
    when 'payment_received' then 'payments'
    when 'payment_problem' then 'payments'
    when 'team_sheet_saved' then 'team'
    when 'org_announcement' then 'team'
    when 'gym_visitor_lead' then 'team'
    else null
  end
$function$;
