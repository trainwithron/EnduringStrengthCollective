-- STEP 10: 0268 guard fixes: a client's new session cannot start pre-flagged, workout totals recompute correctly, audit rows stop copying message text
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: A client's own new workout always starts as self-logged; editing an imported session still updates its totals; blocked rewrites of messages are recorded without the text; the service role can no longer write the audit log; the duplicate set-logs recompute trigger is gone.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_proc where proname = 'guard_athlete_session_insert' and pronamespace = 'public'::regnamespace))) then
    raise exception 'Step 10 (0268) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0268_guard_fixes_and_audit_redaction.sql
-- ====================================================================================================

-- Follow-ups to 0266 and 0267 from the security review.
--
-- 1. athlete_sessions INSERT: 0266 guarded updates only, so a client could still INSERT a session already flagged coach-logged, marked to deduct a
--    session credit, or tied to a booking. An end user's own new session now always starts as a self-logged one (not coach-logged, no credit
--    deduction, no booking). is_historical is left alone on insert on purpose: the history import writes it for the client's own past lifts.
-- 2. workout_logs: the set_logs recompute trigger updates workout_logs totals as a nested trigger call, which the 0266 guard then undid for a client's
--    edit of an imported (historical) session. The guard now steps aside when it is fired from inside another trigger (pg_trigger_depth() > 1).
--    Live also has a second, identical recompute trigger on set_logs (trg_recompute_workout_log) that the repo never created; it is dropped so the
--    totals are recomputed once per change, not twice.
-- 3. audit trail: a blocked rewrite of a direct message or a partner request no longer copies the message text into the append-only table (it records
--    that the text was changed, not what it said); and the service role no longer has insert/update/delete/truncate on audit_log at all (the trigger
--    functions that write it do not need it). To purge audit rows deliberately, see "Audit trail purge" in docs/RUNBOOK.md.
-- Requires 0266 and 0267. Re-runnable.

-- ---- 1. athlete_sessions insert ---------------------------------------------------------------------------------------------------
create or replace function public.guard_athlete_session_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(new.group_id), false) then
    perform public.audit_blocked('athlete_sessions', new.id::text,
      jsonb_build_object('logged_by_coach', false, 'deduct_session_credit', false, 'booking_id', null),
      to_jsonb(new), array['logged_by_coach', 'deduct_session_credit', 'booking_id']);
    new.logged_by_coach := false;
    new.deduct_session_credit := false;
    new.booking_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists athlete_sessions_guard_insert on public.athlete_sessions;
create trigger athlete_sessions_guard_insert
  before insert on public.athlete_sessions
  for each row execute function public.guard_athlete_session_insert();

-- ---- 2. workout_logs guard and the duplicate recompute trigger -------------------------------------------------------------------
create or replace function public.guard_workout_log_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fired from inside another trigger (the set_logs recompute): not an end user's own write.
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    perform public.audit_blocked('workout_logs', old.id::text, to_jsonb(old), to_jsonb(new),
      array['total_volume', 'total_sets_completed', 'total_duration_seconds', 'new_prs', 'logged_by_coach', 'athlete_id', 'group_id', 'session_id', 'workout_id']);
    new.total_volume := old.total_volume;
    new.total_sets_completed := old.total_sets_completed;
    new.total_duration_seconds := old.total_duration_seconds;
    new.new_prs := old.new_prs;
    new.logged_by_coach := old.logged_by_coach;
    new.athlete_id := old.athlete_id;
    new.group_id := old.group_id;
    new.session_id := old.session_id;
    new.workout_id := old.workout_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

do $drop$
begin
  if exists (select 1 from pg_trigger where tgname = 'set_logs_recompute_workout_log' and tgrelid = 'public.set_logs'::regclass) then
    drop trigger if exists trg_recompute_workout_log on public.set_logs;
  end if;
end
$drop$;

-- ---- 3. audit trail ---------------------------------------------------------------------------------------------------------------
-- Like audit_blocked, but a column named in p_redact is recorded as {"changed": true} instead of its old and new values.
create or replace function public.audit_blocked_redacted(p_table text, p_key text, p_old jsonb, p_new jsonb, p_cols text[], p_redact text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diff jsonb := public.audit_diff(p_old, p_new, p_cols);
  c text;
begin
  if v_diff = '{}'::jsonb then
    return;
  end if;
  foreach c in array p_redact loop
    if v_diff ? c then
      v_diff := v_diff || jsonb_build_object(c, jsonb_build_object('changed', true));
    end if;
  end loop;
  perform public.audit_record(p_table, p_key, 'blocked_write', v_diff);
end;
$$;
revoke all on function public.audit_blocked_redacted(text, text, jsonb, jsonb, text[], text[]) from public, anon, authenticated, service_role;

create or replace function public.guard_direct_message_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    perform public.audit_blocked_redacted('direct_messages', old.id::text, to_jsonb(old), to_jsonb(new),
      array['sender_id', 'recipient_id', 'body', 'group_id', 'broadcast_batch_id'], array['body']);
    new.group_id := old.group_id;
    new.sender_id := old.sender_id;
    new.recipient_id := old.recipient_id;
    new.body := old.body;
    new.created_at := old.created_at;
    new.broadcast_batch_id := old.broadcast_batch_id;
  end if;
  return new;
end;
$$;

create or replace function public.guard_partner_request_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    perform public.audit_blocked_redacted('training_partner_requests', old.id::text, to_jsonb(old), to_jsonb(new),
      array['from_athlete_id', 'to_athlete_id', 'message'], array['message']);
    new.from_athlete_id := old.from_athlete_id;
    new.to_athlete_id := old.to_athlete_id;
    new.message := old.message;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- Nothing but the trigger functions writes audit_log. The service role keeps read access only.
revoke insert, update, delete, truncate on public.audit_log from service_role;
revoke usage, update on sequence public.audit_log_id_seq from service_role;

commit;
