-- ============================================================================
-- Recompute workout_logs.total_volume / total_sets_completed whenever a
-- coach or athlete edits set_logs after the session was already completed.
-- Scoped to volume/set-count only — new_prs is a point-in-time record set at
-- workout completion and is not retroactively revised by later corrections.
-- ============================================================================

create or replace function public.recompute_workout_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_session_id uuid;
  v_total_volume numeric(10,2);
  v_total_sets int;
begin
  if tg_op = 'DELETE' then
    select se.session_id into affected_session_id
    from public.session_exercises se
    where se.id = old.session_exercise_id;
  else
    select se.session_id into affected_session_id
    from public.session_exercises se
    where se.id = new.session_exercise_id;
  end if;

  if affected_session_id is null then
    return null;
  end if;

  select
    coalesce(sum(sl.weight * sl.reps), 0),
    count(*)
  into v_total_volume, v_total_sets
  from public.set_logs sl
  join public.session_exercises se on se.id = sl.session_exercise_id
  where se.session_id = affected_session_id
    and sl.status = 'completed';

  update public.workout_logs
  set total_volume = v_total_volume,
      total_sets_completed = v_total_sets
  where session_id = affected_session_id;

  return null;
end;
$$;

create trigger set_logs_recompute_workout_log
after insert or update or delete on public.set_logs
for each row
execute function public.recompute_workout_log();
