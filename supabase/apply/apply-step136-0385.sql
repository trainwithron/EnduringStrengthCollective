-- STEP 136: 0385 The kind of each set (warm-up, working, as-many-as-possible, back-off, drop); a warm-up or drop set never counts toward a goal, a record or a training max; records are per number of reps and a longer hold is a record; a training max comes only from a set of 1 to 8 reps
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen at first. Every set already logged is a working set. From now on a client can tap a set number to mark it a warm-up; a warm-up or drop set no longer sets a record or a training max. A personal record now means no earlier set was at least as heavy for at least as many reps, and for a hold a longer time is the record. A training max is estimated only from sets of 1 to 8 reps. Marking a saved set a warm-up rebuilds that exercise's training max.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'set_type'))) then
    raise exception 'Step 136 (0385) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0385_set_types_and_records.sql
-- ====================================================================================================

-- Release CL, part 1: the kind of each set, and records that count only real work.
--   * set_logs.set_type (and group_workout_exercise_sets.set_type): warmup, working, amrap, backoff or drop. Every existing row is a working set.
--   * A warm-up or drop set never raises a training max, never makes a record, and never counts toward a goal. A NEW training max comes only from a set of 1 to 8 reps (it was 1 to 12), but no stored max is wiped or lowered by that change: a max resting on sets of 9 to 12 reps is kept (down to what those sets still support). No rebuild runs when this is applied.
--   * A personal record is now per number of reps: a working set is a record when no earlier set was at least as heavy for at least as many reps. A longer hold is a record (it was the shorter one).
--   * Marking a set a warm-up (or back) after it was saved rebuilds that exercise's training max.
-- Everything below is the earlier definition (0372) with only the lines named above changed.

alter table public.set_logs add column if not exists set_type text not null default 'working';
alter table public.set_logs add constraint set_logs_set_type_check check (set_type in ('warmup', 'working', 'amrap', 'backoff', 'drop'));
alter table public.group_workout_exercise_sets add column if not exists set_type text not null default 'working';
alter table public.group_workout_exercise_sets add constraint group_workout_exercise_sets_set_type_check check (set_type in ('warmup', 'working', 'amrap', 'backoff', 'drop'));

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
    -- a stored max that rests on sets of 9 to 12 reps is kept, down to what those sets still support
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
$$;

revoke all on function public.recompute_training_maxes(uuid, text) from public, anon;
grant execute on function public.recompute_training_maxes(uuid, text) to authenticated;

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
$$;

-- Marking a saved set a warm-up (or a working set again) rebuilds that exercise's training max from the counted sets.
create or replace function public.recompute_on_set_type_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete uuid;
  v_exercise text;
begin
  if (old.set_type in ('working', 'amrap', 'backoff')) is distinct from (new.set_type in ('working', 'amrap', 'backoff')) then
    select s.athlete_id, se.exercise_name into v_athlete, v_exercise
    from public.session_exercises se
    join public.athlete_sessions s on s.id = se.session_id
    where se.id = new.session_exercise_id;
    if v_athlete is not null and v_exercise is not null then
      perform public.recompute_training_maxes(v_athlete, v_exercise);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.recompute_on_set_type_change() from public, anon, authenticated;

drop trigger if exists set_logs_set_type_recompute on public.set_logs;
create trigger set_logs_set_type_recompute
  after update of set_type on public.set_logs
  for each row when (old.set_type is distinct from new.set_type)
  execute function public.recompute_on_set_type_change();

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

  -- A new personal record, per number of reps: a working set is a record when no earlier set was at least as heavy for at least as many reps. A longer hold is better, a shorter timed distance or
  -- a faster pace is better. Warm-up and drop sets never count.
  with cur as (
    select se.exercise_name as name, sl.weight, sl.reps, sl.distance, sl.time_seconds,
      case when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
           when sl.pace ~ '^[0-9]+(\.[0-9]+)?$' then sl.pace::numeric
           else null end as pace_s
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and sl.set_type in ('working', 'amrap', 'backoff')
  ),
  prior as (
    select se.exercise_name as name, sl.weight, sl.reps, sl.distance, sl.time_seconds,
      case when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
           when sl.pace ~ '^[0-9]+(\.[0-9]+)?$' then sl.pace::numeric
           else null end as pace_s
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions asx on asx.id = se.session_id
    where asx.athlete_id = v_session.athlete_id
      and se.session_id <> p_session_id
      and sl.status = 'completed'
      and (sl.data_flag is null or sl.data_flag = 'accepted')
      and sl.set_type in ('working', 'amrap', 'backoff')
  )
  select coalesce(array_agg(distinct q.name), '{}')
    into v_new_prs
  from (
    select c.name from cur c
    where c.weight > 0
      and exists (select 1 from prior p where p.name = c.name and p.weight is not null)
      and not exists (select 1 from prior p where p.name = c.name and p.weight >= c.weight and coalesce(p.reps, 0) >= coalesce(c.reps, 0))
    union
    select c.name from cur c
    where c.distance is not null
      and exists (select 1 from prior p where p.name = c.name and p.distance is not null)
      and c.distance > (select max(p.distance) from prior p where p.name = c.name)
    union
    select c.name from cur c
    where c.time_seconds is not null and c.distance is null and c.pace_s is null
      and exists (select 1 from prior p where p.name = c.name and p.time_seconds is not null and p.distance is null and p.pace_s is null)
      and c.time_seconds > (select max(p.time_seconds) from prior p where p.name = c.name and p.time_seconds is not null and p.distance is null and p.pace_s is null)
    union
    select c.name from cur c
    where c.time_seconds is not null and (c.distance is not null or c.pace_s is not null)
      and exists (select 1 from prior p where p.name = c.name and p.time_seconds is not null and (p.distance is not null or p.pace_s is not null))
      and c.time_seconds < (select min(p.time_seconds) from prior p where p.name = c.name and p.time_seconds is not null and (p.distance is not null or p.pace_s is not null))
    union
    select c.name from cur c
    where c.pace_s is not null
      and exists (select 1 from prior p where p.name = c.name and p.pace_s is not null)
      and c.pace_s < (select min(p.pace_s) from prior p where p.name = c.name and p.pace_s is not null)
  ) q;

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
      and (sl.distance is not null or sl.pace is not null)
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'time_seconds', 'higher_better',
      se.exercise_name, max(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
      and sl.distance is null and sl.pace is null
      and sl.set_type in ('working', 'amrap', 'backoff')
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
      and sl.set_type in ('working', 'amrap', 'backoff')
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
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
      and (sl.distance is not null or sl.pace is not null)
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'time_seconds', 'higher_better',
      se.exercise_name, max(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
      and sl.distance is null and sl.pace is null
      and sl.set_type in ('working', 'amrap', 'backoff')
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
      and sl.set_type in ('working', 'amrap', 'backoff')
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
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
      and (sl.distance is not null or sl.pace is not null)
      and sl.set_type in ('working', 'amrap', 'backoff')
    group by se.exercise_name

    union all

    select 'time_seconds', 'higher_better',
      se.exercise_name, max(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
      and sl.distance is null and sl.pace is null
      and sl.set_type in ('working', 'amrap', 'backoff')
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
      and sl.set_type in ('working', 'amrap', 'backoff')
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

commit;
