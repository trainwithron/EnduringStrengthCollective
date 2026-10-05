-- STEP 2 of 2 for migration 0267 (audit trail). Run apply-0267-precheck.sql first: every row must say ok = true.
-- One transaction, re-runnable. Apply AFTER 0266. If you ever re-run the 0266 file after this one, run this file again straight after it:
-- 0266 re-creates the guard functions without the audit logging, and this file puts the logging back.

begin;

-- A small audit trail: privileged changes leave a trace, and so do blocked attempts.
--
-- audit_log is append-only and readable only by the platform admin. Rows are written only by the trigger functions below (security definer);
-- nobody can insert, update, delete or truncate one from the API, and a trigger refuses it even for the service role.
--
-- Watched, written when a watched column actually changes (a save that changes nothing writes nothing):
--   profiles              is_platform_admin, intake_required, claimed_at   (inserts too: a new profile is rare and worth seeing)
--   session_credits       balance, payment_hold                            (inserts too; the ledger explains normal changes; this says who and with what role)
--   bookings              credit_state                                     (updates only)
--   organization_billing  every column                                     (inserts too)
-- Blocked attempts: the guards from 0085 and 0266 put a protected column back for an end user; they now also record what was attempted
-- (action 'blocked_write'), so a tamper attempt that changed nothing still leaves a trace.
-- actor_role is the caller's API role ('authenticated', 'service_role'); no role at all is the SQL editor and is recorded as 'sql_editor'.
-- Requires 0266 (re-creates its guard functions with logging). Re-runnable.

create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  table_name text not null,
  row_key text,
  action text not null check (action in ('insert', 'update', 'blocked_write')),
  actor_uid uuid,
  actor_role text not null,
  changed jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_table_idx on public.audit_log (table_name, at desc);

alter table public.audit_log enable row level security;
drop policy if exists "audit_log_select_platform_admin" on public.audit_log;
create policy "audit_log_select_platform_admin" on public.audit_log for select
  to authenticated using (coalesce(public.is_platform_admin(), false));
-- No insert, update or delete policy, and no table privileges beyond reading for a signed-in user.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

create or replace function public.audit_log_refuse_changes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The audit log is append-only';
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_refuse_changes();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_refuse_changes();

-- The one writer. Only trigger functions (security definer) call it.
create or replace function public.audit_record(p_table text, p_key text, p_action text, p_changed jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (table_name, row_key, action, actor_uid, actor_role, changed)
  values (p_table, p_key, p_action, auth.uid(), coalesce(auth.role(), 'sql_editor'), coalesce(p_changed, '{}'::jsonb));
end;
$$;
revoke all on function public.audit_record(text, text, text, jsonb) from public, anon, authenticated, service_role;

-- {column: {old, new}} for the listed columns that differ between two rows (p_old null = an insert: every listed column's new value).
create or replace function public.audit_diff(p_old jsonb, p_new jsonb, p_cols text[])
returns jsonb
language plpgsql
immutable
as $$
declare
  c text;
  out jsonb := '{}'::jsonb;
begin
  foreach c in array p_cols loop
    if p_old is null then
      out := out || jsonb_build_object(c, jsonb_build_object('new', p_new -> c));
    elsif (p_old -> c) is distinct from (p_new -> c) then
      out := out || jsonb_build_object(c, jsonb_build_object('old', p_old -> c, 'new', p_new -> c));
    end if;
  end loop;
  return out;
end;
$$;

-- Generic watcher. Trigger arguments: columns ('*' = every column except updated_at), 'insert_too' or 'update_only', key columns.
create or replace function public.audit_watch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_cols text[];
  v_key text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' and tg_argv[1] <> 'insert_too' then
    return new;
  end if;
  if tg_argv[0] = '*' then
    select array_agg(k) into v_cols from jsonb_object_keys(v_new) k where k <> 'updated_at';
  else
    v_cols := string_to_array(tg_argv[0], ',');
  end if;
  v_diff := public.audit_diff(v_old, v_new, v_cols);
  if v_diff = '{}'::jsonb then
    return new;
  end if;
  select string_agg(v_new ->> k, ':') into v_key from unnest(string_to_array(tg_argv[2], ',')) k;
  perform public.audit_record(tg_table_name, v_key, lower(tg_op), v_diff);
  return new;
end;
$$;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after insert or update on public.profiles
  for each row execute function public.audit_watch('is_platform_admin,intake_required,claimed_at', 'insert_too', 'id');

drop trigger if exists session_credits_audit on public.session_credits;
create trigger session_credits_audit after insert or update on public.session_credits
  for each row execute function public.audit_watch('balance,payment_hold', 'insert_too', 'athlete_id,group_id');

drop trigger if exists bookings_audit on public.bookings;
create trigger bookings_audit after insert or update on public.bookings
  for each row execute function public.audit_watch('credit_state', 'update_only', 'id');

drop trigger if exists organization_billing_audit on public.organization_billing;
create trigger organization_billing_audit after insert or update on public.organization_billing
  for each row execute function public.audit_watch('*', 'insert_too', 'organization_id');

-- ---- blocked attempts -------------------------------------------------------------------------------------------------------------
-- Records what an end user tried to set on the listed columns (only the ones that actually differ from what is kept).
create or replace function public.audit_blocked(p_table text, p_key text, p_old jsonb, p_new jsonb, p_cols text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diff jsonb := public.audit_diff(p_old, p_new, p_cols);
begin
  if v_diff <> '{}'::jsonb then
    perform public.audit_record(p_table, p_key, 'blocked_write', v_diff);
  end if;
end;
$$;
revoke all on function public.audit_blocked(text, text, jsonb, jsonb, text[]) from public, anon, authenticated, service_role;

-- 0085's guard, same behaviour, plus the record.
create or replace function public.prevent_platform_admin_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin then
    if auth.role() <> 'service_role' then
      perform public.audit_blocked('profiles', old.id::text, to_jsonb(old), to_jsonb(new), array['is_platform_admin']);
      new.is_platform_admin := old.is_platform_admin;
    end if;
  end if;
  return new;
end;
$$;

-- 0266's guards, same behaviour, plus the record of what was attempted.
create or replace function public.guard_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      perform public.audit_blocked('profiles', new.id::text, jsonb_build_object('is_platform_admin', false, 'claimed_at', null, 'intake_required', true), to_jsonb(new), array['is_platform_admin', 'claimed_at', 'intake_required']);
      new.is_platform_admin := false;
      new.claimed_at := null;
      new.intake_required := true;
    else
      perform public.audit_blocked('profiles', old.id::text, to_jsonb(old), to_jsonb(new), array['intake_required', 'claimed_at']);
      new.intake_required := old.intake_required;
      new.claimed_at := old.claimed_at;
    end if;
  end if;
  return new;
end;
$$;

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
  end if;
  return new;
end;
$$;

create or replace function public.guard_workout_log_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

create or replace function public.guard_post_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    -- From here the move into Announcements is put back and recorded instead of raising (a raise would roll the record back too).
    if new.channel = 'announcements' and new.channel is distinct from old.channel then
      perform public.audit_blocked('posts', old.id::text, to_jsonb(old), to_jsonb(new), array['channel']);
      new.channel := old.channel;
    end if;
    perform public.audit_blocked('posts', old.id::text, to_jsonb(old), to_jsonb(new), array['pinned_at', 'author_id', 'group_id', 'post_type', 'workout_log_id']);
    new.pinned_at := old.pinned_at;
    new.author_id := old.author_id;
    new.group_id := old.group_id;
    new.post_type := old.post_type;
    new.workout_log_id := old.workout_log_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace function public.guard_direct_message_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    perform public.audit_blocked('direct_messages', old.id::text, to_jsonb(old), to_jsonb(new), array['sender_id', 'recipient_id', 'body', 'group_id', 'broadcast_batch_id']);
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
    perform public.audit_blocked('training_partner_requests', old.id::text, to_jsonb(old), to_jsonb(new), array['from_athlete_id', 'to_athlete_id', 'message']);
    new.from_athlete_id := old.from_athlete_id;
    new.to_athlete_id := old.to_athlete_id;
    new.message := old.message;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

commit;
