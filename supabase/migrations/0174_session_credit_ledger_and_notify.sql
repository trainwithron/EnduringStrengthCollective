-- gym_owner_multi_trainer_session_tracking_real_prospect.md — closes
-- the real, confirmed-live gap: a BOOKED session already decrements
-- session_credits (book_session's own perform adjust_session_credits
-- call), but a session logged in-person after the fact through
-- complete_workout_session never touched credits at all — a real
-- asymmetry for a gym owner whose trainers log walk-in sessions just as
-- often as pre-booked ones. Only fires when the session was actually
-- coach-logged (never touches an athlete's own self-completed workout)
-- and a session_credits row already exists for this athlete+group (a
-- client with no credit relationship at all is completely unaffected).
-- Postgres won't let CREATE OR REPLACE change a function's return type
-- (adding a column to a RETURNS TABLE counts) — drop first.
drop function if exists public.complete_workout_session(uuid);

create function public.complete_workout_session(p_session_id uuid)
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

  -- The real gap this migration closes — see header comment.
  if v_session.logged_by_coach then
    update public.session_credits
      set balance = greatest(0, balance - 1), updated_at = v_completed_at
      where session_credits.athlete_id = v_session.athlete_id and session_credits.group_id = v_session.group_id;
    if found then
      v_credit_consumed := true;
    end if;
  end if;

  return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), coalesce(v_new_records, '{}'), v_credit_consumed;
end;
$function$;

-- Lets any coach in an organization reach that org's owner's push
-- subscription — additive, doesn't touch the existing own-or-coach
-- policy. Needed for the low-session-balance staircase below: a
-- trainer completing/booking a session for their own client also needs
-- to be able to notify the org owner, not just the client themselves.
-- Purely additive (a new SELECT policy — RLS policies for the same
-- action are OR-combined), so it can only ever grant more visibility
-- into who's the org's own owner, never less of anything already there.
create policy "push_subscriptions_select_org_owner" on public.push_subscriptions for select
  to authenticated using (
    exists (
      select 1
      from public.organization_memberships om_owner
      join public.organization_memberships om_caller on om_caller.organization_id = om_owner.organization_id
      where om_owner.profile_id = push_subscriptions.profile_id
        and om_owner.role = 'owner'
        and om_caller.profile_id = (select auth.uid())
    )
  );
