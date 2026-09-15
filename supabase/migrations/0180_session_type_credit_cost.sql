-- gym_owner_multi_trainer_session_tracking_real_prospect.md — the
-- credit_cost design that was actually resolved (2026-09-14) never made
-- it into complete_workout_session(), which still does a flat -1 per
-- coach-logged session regardless of what kind of session it was. Ron's
-- own direct word: "we definitely don't want to be accidentally burning
-- client credits" — an admin/internal session (a scheduling call, a
-- non-billable check-in) shouldn't cost a session credit the same way a
-- real training session does.
--
-- Coach-wide (not group-scoped), same shape as coach_availability_windows
-- — a session type isn't tied to one specific client's group.
create table public.session_types (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  credit_cost int not null default 1 check (credit_cost >= 0),
  created_at timestamptz not null default now()
);

alter table public.session_types enable row level security;

-- Coach-only, full stop — athletes never see or pick a session type, so
-- there's no client-facing read policy to add (unlike coach_packages,
-- which athletes browse to buy).
create policy "session_types_coach_manage" on public.session_types for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

-- Nullable: a session with no type set keeps behaving exactly as every
-- session does today (flat 1-credit cost) — a coach who never creates a
-- session type notices nothing different at all.
alter table public.athlete_sessions
  add column session_type_id uuid references public.session_types(id) on delete set null;

create or replace function public.complete_workout_session(p_session_id uuid)
returns table(workout_log_id uuid, athlete_id uuid, group_id uuid, total_volume numeric, total_sets_completed integer, new_prs text[], new_records text[], credit_consumed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  select * into v_session from public.athlete_sessions where id = p_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  if auth.uid() <> v_session.athlete_id and not public.is_group_coach(v_session.group_id) then
    raise exception 'not authorized to complete this session';
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

  with session_best as (
    select se.exercise_name as name, max(sl.weight) as best
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
    group by se.exercise_name
  ),
  prior_best as (
    select se.exercise_name as name, max(sl.weight) as best
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions asx on asx.id = se.session_id
    where asx.athlete_id = v_session.athlete_id
      and se.session_id <> p_session_id
      and sl.status = 'completed'
    group by se.exercise_name
  )
  select coalesce(array_agg(sb.name), '{}')
    into v_new_prs
  from session_best sb
  join prior_best pb on pb.name = sb.name
  where sb.best > pb.best;

  with session_best_weight as (
    select se.exercise_name as name,
           max(sl.weight) as best,
           (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and tracked_field = 'weight' and superseded_at is null
  ),
  broken as (
    select sbw.name, sbw.best, sbw.best_set_log_id
    from session_best_weight sbw
    left join current_records cr on cr.exercise_name = sbw.name
    where cr.exercise_name is null or sbw.best > cr.value
  )
  select coalesce(array_agg(b.name), '{}') into v_new_records from broken b;

  update public.exercise_records
    set superseded_at = v_completed_at
    where exercise_records.group_id = v_session.group_id and tracked_field = 'weight' and superseded_at is null
      and exercise_name = any(v_new_records);

  with session_best_weight as (
    select se.exercise_name as name,
           max(sl.weight) as best,
           (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and tracked_field = 'weight' and superseded_at is null
  ),
  broken as (
    select sbw.name, sbw.best, sbw.best_set_log_id
    from session_best_weight sbw
    left join current_records cr on cr.exercise_name = sbw.name
    where cr.exercise_name is null or sbw.best > cr.value
  )
  insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, set_log_id, achieved_at)
  select v_session.group_id, b.name, 'weight', 'higher_better', b.best, v_session.athlete_id, b.best_set_log_id, v_completed_at
  from broken b;

  insert into public.workout_logs (
    session_id, athlete_id, group_id, workout_id,
    total_duration_seconds, total_volume, total_sets_completed, new_prs, logged_by_coach
  ) values (
    p_session_id, v_session.athlete_id, v_session.group_id, v_session.workout_id,
    v_duration, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), v_session.logged_by_coach
  )
  returning id into v_log_id;

  -- credit_cost lives on the session's own type (default 1 when no type
  -- is set — every session that predates this feature, and every coach
  -- who never bothers to create a type, keeps the exact prior behavior).
  -- A type explicitly set to 0 (an admin/internal session) skips the
  -- session_credits update entirely rather than decrementing by zero.
  v_credit_cost := 1;
  if v_session.session_type_id is not null then
    select credit_cost into v_credit_cost from public.session_types where id = v_session.session_type_id;
    if v_credit_cost is null then
      v_credit_cost := 1;
    end if;
  end if;

  if v_session.logged_by_coach and v_credit_cost > 0 then
    update public.session_credits
      set balance = greatest(0, balance - v_credit_cost), updated_at = v_completed_at
      where session_credits.athlete_id = v_session.athlete_id and session_credits.group_id = v_session.group_id;
    if found then
      v_credit_consumed := true;
    end if;
  end if;

  return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), coalesce(v_new_records, '{}'), v_credit_consumed;
end;
$function$;
