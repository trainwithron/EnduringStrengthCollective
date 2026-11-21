CREATE OR REPLACE FUNCTION public.recompute_training_max()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_exercise_name text;
  v_athlete_id uuid;
  v_historical boolean;
  v_reserve_reps numeric;
  v_estimate numeric;
  v_rpe numeric;
  v_rpe_assumed boolean;
begin
  if new.status <> 'completed' or new.weight is null or new.reps is null
     or new.weight <= 0 or new.reps <= 0 or new.reps > 8
     or new.set_type not in ('working', 'amrap', 'backoff') then
    return new;
  end if;
  if coalesce(new.is_historical, false) then
    return new;
  end if;

  if new.rpe is null then
    v_rpe := 9;
    v_rpe_assumed := true;
  else
    v_rpe := new.rpe;
    v_rpe_assumed := false;
  end if;

  select se.exercise_name, s.athlete_id, s.is_historical into v_exercise_name, v_athlete_id, v_historical
  from public.session_exercises se
  join public.athlete_sessions s on s.id = se.session_id
  where se.id = new.session_exercise_id;

  if v_exercise_name is null or v_athlete_id is null or coalesce(v_historical, false) then
    return new;
  end if;

  v_reserve_reps := greatest(0, 10 - v_rpe);
  v_estimate := round((new.weight * (1 + (new.reps + v_reserve_reps) / 30.0))::numeric, 1);

  insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe, source_rpe_assumed, updated_at)
  values (v_athlete_id, v_exercise_name, v_estimate, new.weight, new.reps, v_rpe, v_rpe_assumed, now())
  on conflict (athlete_id, exercise_name) do update
    set estimated_max = excluded.estimated_max,
        source_weight = excluded.source_weight,
        source_reps = excluded.source_reps,
        source_rpe = excluded.source_rpe,
        source_rpe_assumed = excluded.source_rpe_assumed,
        updated_at = excluded.updated_at
    where excluded.estimated_max > public.athlete_training_maxes.estimated_max;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_training_maxes_internal(p_athlete uuid, p_exercise text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer := 0;
begin
  with counted as (
    select se.exercise_name, sl.weight, sl.reps, coalesce(sl.rpe, 9) as rpe, (sl.rpe is null) as rpe_assumed, sl.completed_at,
           round((sl.weight * (1 + (sl.reps + greatest(0, 10 - coalesce(sl.rpe, 9))) / 30.0))::numeric, 1) as estimate
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions s on s.id = se.session_id
    where s.athlete_id = p_athlete
      and sl.status = 'completed'
      and sl.weight > 0
      and sl.reps >= 1
      and sl.set_type in ('working', 'amrap', 'backoff')
      and (sl.data_flag is null or sl.data_flag = 'accepted')
      and (p_exercise is null or se.exercise_name = p_exercise)
  ),
  best_low as (
    select distinct on (exercise_name) exercise_name, weight, reps, rpe, rpe_assumed, completed_at, estimate
    from counted
    where reps <= 8
    order by exercise_name, estimate desc, completed_at desc nulls last
  ),
  best_high as (
    select distinct on (exercise_name) exercise_name, weight, reps, rpe, rpe_assumed, completed_at, estimate
    from counted
    where reps > 8
    order by exercise_name, estimate desc, completed_at desc nulls last
  ),
  candidates as (
    select exercise_name, estimate, weight, reps, rpe, rpe_assumed, completed_at from best_low
    union all
    -- a stored max that rests on sets of more than 8 reps (the earlier rules allowed any number of reps) is kept, down to what those sets still support; a NEW max never comes from such a set
    select bh.exercise_name,
           least(bh.estimate, m.estimated_max),
           case when m.estimated_max <= bh.estimate then m.source_weight else bh.weight end,
           case when m.estimated_max <= bh.estimate then m.source_reps else bh.reps end,
           case when m.estimated_max <= bh.estimate then m.source_rpe else bh.rpe end,
           case when m.estimated_max <= bh.estimate then m.source_rpe_assumed else bh.rpe_assumed end,
           bh.completed_at
    from best_high bh
    join public.athlete_training_maxes m on m.athlete_id = p_athlete and m.exercise_name = bh.exercise_name
  ),
  best as (
    select distinct on (exercise_name) exercise_name, weight, reps, rpe, rpe_assumed, estimate
    from candidates
    order by exercise_name, estimate desc, completed_at desc nulls last
  ),
  gone as (
    delete from public.athlete_training_maxes m
    where m.athlete_id = p_athlete
      and (p_exercise is null or m.exercise_name = p_exercise)
      and not exists (select 1 from best b where b.exercise_name = m.exercise_name)
    returning 1
  ),
  put as (
    insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe, source_rpe_assumed, updated_at)
    select p_athlete, b.exercise_name, b.estimate, b.weight, b.reps, b.rpe, b.rpe_assumed, now() from best b
    on conflict (athlete_id, exercise_name) do update
      set estimated_max = excluded.estimated_max,
          source_weight = excluded.source_weight,
          source_reps = excluded.source_reps,
          source_rpe = excluded.source_rpe,
          source_rpe_assumed = excluded.source_rpe_assumed,
          updated_at = case when public.athlete_training_maxes.estimated_max is distinct from excluded.estimated_max then excluded.updated_at else public.athlete_training_maxes.updated_at end
    returning 1
  )
  select (select count(*) from put) + (select count(*) from gone) into v_count;
  return v_count;
end;
$function$;
