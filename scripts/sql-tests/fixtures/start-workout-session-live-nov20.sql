CREATE OR REPLACE FUNCTION public.start_workout_session(p_workout_id uuid, p_group_id uuid, p_athlete_id uuid, p_logged_by_coach boolean, p_session_type_id uuid, p_deduct_session_credit boolean, p_booking_id uuid, p_exercises jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_session uuid;
  ex jsonb;
  st jsonb;
  v_exercise uuid;
begin
  select id into v_session
  from public.athlete_sessions
  where athlete_id = p_athlete_id
    and workout_id = p_workout_id
    and group_id = p_group_id
    and status = 'in_progress'
  order by started_at desc
  limit 1;

  if v_session is null then
    insert into public.athlete_sessions (
      workout_id, group_id, athlete_id, logged_by_coach, session_type_id, deduct_session_credit, booking_id
    )
    values (
      p_workout_id, p_group_id, p_athlete_id, coalesce(p_logged_by_coach, false),
      p_session_type_id, coalesce(p_deduct_session_credit, false), p_booking_id
    )
    returning id into v_session;
  end if;

  -- Fill in the exercises and sets if this session has none yet (a brand-new
  -- one, or a legacy one left empty by a dropped connection).
  if not exists (select 1 from public.session_exercises where session_id = v_session) then
    for ex in select * from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
    loop
      insert into public.session_exercises (
        session_id, group_workout_exercise_id, exercise_name, exercise_order, movement_pattern_id, tracked_fields
      )
      values (
        v_session,
        nullif(ex ->> 'group_workout_exercise_id', '')::uuid,
        ex ->> 'exercise_name',
        coalesce((ex ->> 'exercise_order')::int, 0),
        nullif(ex ->> 'movement_pattern_id', '')::uuid,
        coalesce(
          (select array_agg(t) from jsonb_array_elements_text(ex -> 'tracked_fields') t),
          array['reps', 'weight']
        )
      )
      returning id into v_exercise;

      for st in select * from jsonb_array_elements(coalesce(ex -> 'sets', '[]'::jsonb))
      loop
        insert into public.set_logs (session_exercise_id, set_order, weight, reps)
        values (
          v_exercise,
          coalesce((st ->> 'set_order')::int, 0),
          nullif(st ->> 'weight', '')::numeric,
          nullif(st ->> 'reps', '')::int
        );
      end loop;
    end loop;
  end if;

  return v_session;
end;
$function$
;
