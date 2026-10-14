-- UNDO for step 122 (0372). Only if step 122 misbehaves. Puts the training maxes back to what they were before the rebuild, and puts back the old trigger, the old personal-record check and the old Count it function.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
delete from public.athlete_training_maxes m using public.training_max_recompute_log l where m.athlete_id = l.athlete_id and m.exercise_name = l.exercise_name;
insert into public.athlete_training_maxes select (jsonb_populate_record(null::public.athlete_training_maxes, l.before_row)).* from public.training_max_recompute_log l where l.before_row is not null;
drop table if exists public.training_max_recompute_log;
drop function if exists public.client_exercise_rollup(uuid, uuid);
drop function if exists public.recompute_training_maxes(uuid, text);
create or replace function public.recompute_training_max()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exercise_name text;
  v_athlete_id uuid;
  v_historical boolean;
  v_started timestamptz;
  v_reserve_reps numeric;
  v_estimate numeric;
  v_rpe numeric;
  v_rpe_assumed boolean;
begin
  if new.status <> 'completed' or new.weight is null or new.reps is null
     or new.weight <= 0 or new.reps <= 0 then
    return new;
  end if;

  if new.rpe is null then
    v_rpe := 9;
    v_rpe_assumed := true;
  else
    v_rpe := new.rpe;
    v_rpe_assumed := false;
  end if;

  select se.exercise_name, s.athlete_id, s.is_historical, s.started_at into v_exercise_name, v_athlete_id, v_historical, v_started
  from public.session_exercises se
  join public.athlete_sessions s on s.id = se.session_id
  where se.id = new.session_exercise_id;

  if v_exercise_name is null or v_athlete_id is null then
    return new;
  end if;

  -- A history import's own time stamp: noon UTC, 00 minutes, 17 to 19 seconds.
  if coalesce(v_historical, false) and v_started is not null
     and (v_started at time zone 'UTC')::time between time '12:00:17' and time '12:00:19.999999' then
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
$$;
create or replace function public.complete_workout_session(p_session_id uuid)
 RETURNS TABLE(workout_log_id uuid, athlete_id uuid, group_id uuid, total_volume numeric, total_sets_completed integer, new_prs text[], new_records text[], credit_consumed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session record;
  v_completed_at timestamptz := now();
  v_duration int;
  v_total_volume numeric;
  v_total_sets int;
  v_new_prs text[];
  v_new_records text[];
  v_log_id uuid;
  v_credit_consumed boolean := false;
  v_credit_cost int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to complete this session';
  end if;

  select * into v_session from public.athlete_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session not found';
  end if;

  if auth.uid() <> v_session.athlete_id and not public.is_group_coach(v_session.group_id) then
    raise exception 'not authorized to complete this session';
  end if;

  if v_session.status = 'completed' then
    return query
      select l.id, l.athlete_id, l.group_id, l.total_volume, l.total_sets_completed::int, l.new_prs, '{}'::text[], false
      from public.workout_logs l
      where l.session_id = p_session_id;
    if found then
      return;
    end if;
  end if;

  v_duration := extract(epoch from (v_completed_at - v_session.started_at))::int;

  update public.athlete_sessions
    set status = 'completed', completed_at = v_completed_at, duration_seconds = v_duration
    where id = p_session_id;

  select coalesce(sum(sl.weight * sl.reps), 0), count(*)
    into v_total_volume, v_total_sets
  from public.set_logs sl
  join public.session_exercises se on se.id = sl.session_exercise_id
  where se.session_id = p_session_id and sl.status = 'completed';

  with combined_best as (
    select se.exercise_name as name,
      max(sl.weight) as best_weight,
      max(sl.distance) as best_distance,
      min(sl.time_seconds) as best_time,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end) as best_pace_seconds
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
    group by se.exercise_name
  ),
  prior_best as (
    select se.exercise_name as name,
      max(sl.weight) as best_weight,
      max(sl.distance) as best_distance,
      min(sl.time_seconds) as best_time,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end) as best_pace_seconds
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions asx on asx.id = se.session_id
    where asx.athlete_id = v_session.athlete_id
      and se.session_id <> p_session_id
      and sl.status = 'completed'
    group by se.exercise_name
  )
  select coalesce(array_agg(distinct cb.name), '{}')
    into v_new_prs
  from combined_best cb
  join prior_best pb on pb.name = cb.name
  where (cb.best_weight is not null and pb.best_weight is not null and cb.best_weight > pb.best_weight)
     or (cb.best_distance is not null and pb.best_distance is not null and cb.best_distance > pb.best_distance)
     or (cb.best_time is not null and pb.best_time is not null and cb.best_time < pb.best_time)
     or (cb.best_pace_seconds is not null and pb.best_pace_seconds is not null and cb.best_pace_seconds < pb.best_pace_seconds);

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  select coalesce(array_agg(distinct b.name), '{}') into v_new_records from broken b;

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  update public.exercise_records er
    set superseded_at = v_completed_at
    from broken b
    where er.group_id = v_session.group_id and er.superseded_at is null
      and er.exercise_name = b.name and er.tracked_field = b.tracked_field;

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, set_log_id, achieved_at)
  select v_session.group_id, b.name, b.tracked_field, b.direction, b.best, v_session.athlete_id, b.best_set_log_id, v_completed_at
  from broken b;

  insert into public.workout_logs (
    session_id, athlete_id, group_id, workout_id,
    total_duration_seconds, total_volume, total_sets_completed, new_prs, logged_by_coach
  ) values (
    p_session_id, v_session.athlete_id, v_session.group_id, v_session.workout_id,
    v_duration, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), v_session.logged_by_coach
  )
  returning id into v_log_id;

  -- Every session costs exactly 1 credit, whatever its session type (the type's own cost is no longer read).
  v_credit_cost := 1;

  if v_session.logged_by_coach and v_session.booking_id is not null then
    -- The session is on the calendar and the coach logged it: settle that booking (once, never twice).
    v_credit_consumed := public.settle_booking_internal(v_session.booking_id, v_credit_cost, 'Workout logged', auth.uid(), v_session.athlete_id, v_session.group_id);
  elsif v_session.logged_by_coach and v_session.deduct_session_credit and v_credit_cost > 0 then
    -- Not tied to a booking: follows the explicit choice made when the session was started.
    perform public.apply_session_credit_change(v_session.athlete_id, v_session.group_id, -v_credit_cost, 'delivered', 'Workout logged', null, auth.uid());
    v_credit_consumed := true;
  end if;

  return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), coalesce(v_new_records, '{}'), v_credit_consumed;
end;
$function$;
create or replace function public.set_unclear_point_counted(p_set uuid, p_counts boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
begin
  select s.group_id into v_group
  from public.set_logs sl
  join public.session_exercises se on se.id = sl.session_exercise_id
  join public.athlete_sessions s on s.id = se.session_id
  where sl.id = p_set;
  if v_group is null then
    raise exception 'not found';
  end if;
  if auth.uid() is not null and auth.role() <> 'service_role' then
    if not coalesce(public.is_group_coach(v_group), false) or not coalesce(public.group_in_active_org(v_group), false) then
      raise exception 'not authorized';
    end if;
  end if;
  update public.set_logs
    set data_flag = case when p_counts then 'accepted' else 'unclear' end
  where id = p_set and data_flag is not null;
end;
$$;
commit;
