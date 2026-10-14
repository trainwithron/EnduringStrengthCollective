-- STEP 122: 0372 Imported history counts: totals, graphs, estimated maxes and records are read from the sets, and training maxes are rebuilt
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing else to do. The training maxes of every client who has imported history are rebuilt once from the sets that count (the old value of each one that changed is kept, so this step can be undone). Until the code that goes with it is live nothing on screen changes, except that a training max can now go DOWN when it came from an unclear or removed set. A set of more than 12 reps no longer sets a training max.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.client_exercise_rollup(uuid, uuid)') is null)) then
    raise exception 'Step 122 (0372) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0372_imported_history_counts.sql
-- ====================================================================================================

-- Release CB: imported history counts. Everything below is read from the sets themselves, so an imported workout needs no workout log (and therefore no feed post, push, credit, streak, record or
-- share card: none of those can fire).
--
--   * client_exercise_rollup(athlete, group): one row per workout and exercise (date, best weight, best estimated max, volume, sets, imported or logged live), counting only completed sets that
--     are not an unclear data point (migration 0371). The client profile's totals, graphs and records are computed from it, in date order.
--   * recompute_training_maxes(athlete, exercise): rebuilds the estimated training maxes from the counted sets (reps 1 to 12, the same estimate as before: weight x (1 + (reps + reserve) / 30), RPE
--     assumed 9 when not logged). Unlike the trigger it can LOWER a max, so removing an import, counting or leaving out an unclear point, or fixing one gives the right number. Only an athlete's own
--     sets decide it (a number is never typed in), so rebuilding is exact.
--   * The training-max trigger no longer sets a max from an imported set (imports are folded in by recompute_training_maxes after the unclear-point check, so a jumbled value can never raise a max), and
--     a set of more than 12 reps no longer sets one. This replaces the import time-stamp rule of Release BM.
--   * A live personal record is compared against the client's earlier counted sets only: an unclear point can never be the number to beat. (complete_workout_session is replaced whole from its live
--     definition; the only change is one line in prior_best.)
--   * set_unclear_point_counted now also rebuilds that exercise's max.
--   * One-time: the training maxes of every client who has imported history are rebuilt now; the old row of each max that changed is kept in training_max_recompute_log so the step can be undone.
-- Re-runnable.

create table if not exists public.training_max_recompute_log (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null,
  exercise_name text not null,
  before_row jsonb,
  after_row jsonb,
  recomputed_at timestamptz not null default now()
);
alter table public.training_max_recompute_log enable row level security;
revoke all on public.training_max_recompute_log from anon, authenticated;

create or replace function public.recompute_training_maxes(p_athlete uuid, p_exercise text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is not null and auth.role() <> 'service_role' then
    if not (auth.uid() = p_athlete or coalesce(public.is_coach_of_athlete(p_athlete), false)) then
      raise exception 'not authorized';
    end if;
  end if;

  with counted as (
    select se.exercise_name, sl.weight, sl.reps, coalesce(sl.rpe, 9) as rpe, (sl.rpe is null) as rpe_assumed, sl.completed_at,
           round((sl.weight * (1 + (sl.reps + greatest(0, 10 - coalesce(sl.rpe, 9))) / 30.0))::numeric, 1) as estimate
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions s on s.id = se.session_id
    where s.athlete_id = p_athlete
      and sl.status = 'completed'
      and sl.weight > 0
      and sl.reps between 1 and 12
      and (sl.data_flag is null or sl.data_flag = 'accepted')
      and (p_exercise is null or se.exercise_name = p_exercise)
  ),
  best as (
    select distinct on (exercise_name) exercise_name, weight, reps, rpe, rpe_assumed, estimate
    from counted
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
$$;

revoke all on function public.recompute_training_maxes(uuid, text) from public, anon;
grant execute on function public.recompute_training_maxes(uuid, text) to authenticated;

-- Live sets still raise a max as they are logged (only up, as before), now with the 12-rep limit; imported sets never do (the rebuild above folds them in after the unclear-point check).
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
  v_reserve_reps numeric;
  v_estimate numeric;
  v_rpe numeric;
  v_rpe_assumed boolean;
begin
  if new.status <> 'completed' or new.weight is null or new.reps is null
     or new.weight <= 0 or new.reps <= 0 or new.reps > 12 then
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
$$;

-- The coach counts or leaves out an unclear point: the max for that exercise is rebuilt.
create or replace function public.set_unclear_point_counted(p_set uuid, p_counts boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_athlete uuid;
  v_exercise text;
begin
  select s.group_id, s.athlete_id, se.exercise_name into v_group, v_athlete, v_exercise
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
  perform public.recompute_training_maxes(v_athlete, v_exercise);
end;
$$;

-- One row per workout and exercise, counted sets only. security invoker: the caller sees exactly what row security lets them see.
create or replace function public.client_exercise_rollup(p_athlete uuid, p_group uuid)
returns table (
  session_id uuid,
  at timestamptz,
  exercise_name text,
  best_weight numeric,
  best_e1rm numeric,
  volume numeric,
  sets integer,
  imported boolean,
  has_log boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id,
         coalesce(s.completed_at, s.started_at),
         se.exercise_name,
         max(sl.weight) filter (where sl.weight > 0),
         max(round((sl.weight * (1 + (sl.reps + greatest(0, 10 - coalesce(sl.rpe, 9))) / 30.0))::numeric, 1)) filter (where sl.weight > 0 and sl.reps between 1 and 12),
         coalesce(sum(sl.weight * sl.reps) filter (where sl.weight is not null and sl.reps is not null), 0),
         count(*)::integer,
         s.is_historical,
         exists (select 1 from public.workout_logs wl where wl.session_id = s.id)
  from public.athlete_sessions s
  join public.session_exercises se on se.session_id = s.id
  join public.set_logs sl on sl.session_exercise_id = se.id
  where s.athlete_id = p_athlete
    and s.group_id = p_group
    and s.status = 'completed'
    and sl.status = 'completed'
    and (sl.data_flag is null or sl.data_flag = 'accepted')
  group by s.id, se.exercise_name
  order by 2 desc
  limit 4000
$$;

revoke all on function public.client_exercise_rollup(uuid, uuid) from public, anon;
grant execute on function public.client_exercise_rollup(uuid, uuid) to authenticated;

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
      and (sl.data_flag is null or sl.data_flag = 'accepted')
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

-- One-time: rebuild the training maxes of every client who has imported history, keeping the old row of each max that changed.
do $$
declare
  r record;
  before_rows jsonb;
begin
  for r in select distinct s.athlete_id from public.athlete_sessions s where s.is_historical loop
    select coalesce(jsonb_object_agg(m.exercise_name, to_jsonb(m)), '{}'::jsonb) into before_rows
    from public.athlete_training_maxes m where m.athlete_id = r.athlete_id;
    perform public.recompute_training_maxes(r.athlete_id, null);
    insert into public.training_max_recompute_log (athlete_id, exercise_name, before_row, after_row)
    select r.athlete_id, coalesce(a.exercise_name, b.key), b.value, to_jsonb(a)
    from public.athlete_training_maxes a
    full join jsonb_each(before_rows) b on b.key = a.exercise_name and a.athlete_id = r.athlete_id
    where (a.athlete_id = r.athlete_id or a.athlete_id is null)
      and (b.value ->> 'estimated_max') is distinct from (to_jsonb(a) ->> 'estimated_max');
  end loop;
end;
$$;

commit;
