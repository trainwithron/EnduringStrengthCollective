-- Once a workout is completed, a client should not be able to change it. 0236 blocked edits to the SETS of a completed workout, but only
-- UPDATEs: a client could still add new sets to it or delete sets from it (to change the totals the coach and the leaderboard see, or to
-- clean up a bad day), and could flip a completed session back to "in progress" (athlete_sessions.status was not protected), reopening it.
--
-- Now: adding or deleting a set on a completed workout is refused for the client the same way editing one is, and a client cannot reopen a
-- completed session. The coach can still correct anything, history imports (is_historical sessions) are exempt, and the server (service
-- role, including deleting an account) is not blocked. A tab left open that tries to save a set after Finish is refused with the same
-- "This workout was already completed." message the editing case already gives.
-- Re-runnable.

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
  v_exercise uuid;
begin
  -- Internal/admin calls (no signed-in user) and the service role are not blocked.
  if auth.uid() is null or auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_exercise := case when tg_op = 'DELETE' then old.session_exercise_id else new.session_exercise_id end;

  select s.status, s.group_id, s.is_historical
    into v_status, v_group, v_historical
  from public.athlete_sessions s
  join public.session_exercises se on se.session_id = s.id
  where se.id = v_exercise;

  if v_status = 'completed' and not coalesce(v_historical, false)
     and not coalesce(public.is_group_coach(v_group), false) then
    raise exception 'This workout was already completed.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_block_edits_to_completed_session on public.set_logs;
create trigger trg_block_edits_to_completed_session
  before insert or update or delete on public.set_logs
  for each row execute function public.block_athlete_edits_to_completed_session();

-- A client cannot reopen a completed session (the coach can).
create or replace function public.guard_athlete_session_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    new.logged_by_coach := old.logged_by_coach;
    new.deduct_session_credit := old.deduct_session_credit;
    new.booking_id := old.booking_id;
    new.is_historical := old.is_historical;
    new.session_type_id := old.session_type_id;
    new.athlete_id := old.athlete_id;
    new.group_id := old.group_id;
    new.workout_id := old.workout_id;
    if old.status = 'completed' then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;
