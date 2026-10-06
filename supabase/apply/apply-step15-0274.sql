-- STEP 15: 0274 a completed workout is locked against added or deleted sets and against being reopened by the client
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Finishing a workout works as before. After Finish a client can no longer add or delete sets of that workout or reopen it (the coach still can, history imports are unaffected). A tab left open that tries to save after Finish shows the existing 'already completed' message.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((coalesce((select position('tg_op' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'block_athlete_edits_to_completed_session' and p.pronamespace = 'public'::regnamespace), false))) then
    raise exception 'Step 15 (0274) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0274_completed_workout_lock.sql
-- ====================================================================================================

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

-- A client cannot reopen a completed session (the coach can). This is 0267's version of the guard (it keeps the record of blocked writes)
-- plus the reopen rule.
create or replace function public.guard_athlete_session_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    perform public.audit_blocked('athlete_sessions', old.id::text, to_jsonb(old), to_jsonb(new),
      array['logged_by_coach', 'deduct_session_credit', 'booking_id', 'is_historical', 'session_type_id', 'athlete_id', 'group_id', 'workout_id']);
    new.logged_by_coach := old.logged_by_coach;
    new.deduct_session_credit := old.deduct_session_credit;
    new.booking_id := old.booking_id;
    new.is_historical := old.is_historical;
    new.session_type_id := old.session_type_id;
    new.athlete_id := old.athlete_id;
    new.group_id := old.group_id;
    new.workout_id := old.workout_id;
    -- Reopening a completed session is refused and recorded (finishing a session is not a change from "completed", so it is never logged).
    if old.status = 'completed' and new.status is distinct from old.status then
      perform public.audit_blocked('athlete_sessions', old.id::text, to_jsonb(old), to_jsonb(new), array['status']);
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

commit;
