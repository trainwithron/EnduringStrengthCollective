-- STEP 05: 0236 workout session integrity: one log per workout however many times Finish is tapped, no edits to a completed workout, atomic resumable start
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Tapping Finish twice no longer creates a second workout log, post or session charge; a client cannot edit a workout after completing it (the coach still can); Start Workout is one safe step that Resume can pick up.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'workout_logs_session_id_key'))) then
    raise exception 'Step 05 (0236) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0236_workout_session_integrity.sql
-- ====================================================================================================

-- Workout logging data integrity, before real clients log every set.
--
-- 1. Completing a workout is idempotent. A lost response followed by a second
--    tap used to complete the session again: a duplicate workout_logs row, a
--    duplicate feed post, and (for coach-logged sessions) a second credit
--    deduction. Now the session row is locked, a repeat call returns the
--    existing log untouched, and workout_logs.session_id is unique.
-- 2. A completed workout can't be edited by the athlete from a stale tab or a
--    second device (their set_logs updates are rejected); the coach still can.
-- 3. Starting a workout is ONE atomic function. It was three separate inserts
--    (session, exercises, sets): a dropped signal in between left an empty
--    session that could never be restarted. The function is also idempotent
--    (an in-progress session for the same workout is reused and, if it was
--    left empty, filled in), which makes "Resume" work.

-- ---- 1. idempotent completion ----------------------------------------------

create unique index if not exists workout_logs_session_id_key
  on public.workout_logs (session_id)
  where session_id is not null;

-- The whole function is replaced (no text matching): the function as it is AFTER 0248 (which must be applied first, as the rollout order says),
-- with two changes: the session row is locked while it is completed, and a repeat call returns the existing log untouched.
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

  v_credit_cost := 1;
  if v_session.session_type_id is not null then
    select credit_cost into v_credit_cost from public.session_types where id = v_session.session_type_id;
    if v_credit_cost is null then
      v_credit_cost := 1;
    end if;
  end if;

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

-- ---- 2. no athlete edits to a completed workout -----------------------------

create or replace function public.block_athlete_edits_to_completed_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.session_status;
  v_group uuid;
  v_historical boolean;
begin
  -- Internal/admin calls (no signed-in user) and the service role are not blocked.
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;

  select s.status, s.group_id, s.is_historical
    into v_status, v_group, v_historical
  from public.athlete_sessions s
  join public.session_exercises se on se.session_id = s.id
  where se.id = new.session_exercise_id;

  if v_status = 'completed' and not coalesce(v_historical, false)
     and not coalesce(public.is_group_coach(v_group), false) then
    raise exception 'This workout was already completed.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_edits_to_completed_session on public.set_logs;
create trigger trg_block_edits_to_completed_session
  before update on public.set_logs
  for each row execute function public.block_athlete_edits_to_completed_session();

-- ---- 3. atomic, resumable start ---------------------------------------------

-- p_exercises: [{ group_workout_exercise_id, exercise_name, exercise_order,
--   movement_pattern_id, tracked_fields: [...], sets: [{ set_order, weight, reps }] }]
-- SECURITY INVOKER: the caller's row-level security applies exactly as it did
-- to the three separate inserts this replaces.
create or replace function public.start_workout_session(
  p_workout_id uuid,
  p_group_id uuid,
  p_athlete_id uuid,
  p_logged_by_coach boolean,
  p_session_type_id uuid,
  p_deduct_session_credit boolean,
  p_booking_id uuid,
  p_exercises jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
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
$$;

revoke execute on function public.start_workout_session(uuid, uuid, uuid, boolean, uuid, boolean, uuid, jsonb) from public, anon;
grant execute on function public.start_workout_session(uuid, uuid, uuid, boolean, uuid, boolean, uuid, jsonb) to authenticated, service_role;

commit;
