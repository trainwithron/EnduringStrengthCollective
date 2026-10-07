-- RELEASE L (SCHEDULE REQUESTS): ONE paste. Steps 42 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 42: Nothing changes for anyone until the code in the same release is live. After that: a client with a weekly schedule sees My schedule with three buttons (pause, freeze, cancel), chooses a date and sends; the coach sees the request in Needs your decision and the schedule changes by itself on the chosen date (or when the coach presses Done on or after it). A freeze restarts on its day and adds its length to the expiry of the client's unused sessions (only for a coach who has an expiry window). No existing function is replaced and no existing row changes.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release L (schedule requests), step 42: 0297 pause, freeze or cancel a client's weekly schedule: a client asks (their own schedule only) and the change takes effect on the date they chose unless the coach handles it first; the request table, a coach-only table for the client's private note, the freeze dates on the schedule, the functions the app uses to apply a request and to restart a freeze on its day, a freeze that adds its length to the expiry of the client's unused sessions through the expiry hold that already exists, and three new notification types added to the list the database already has
do $g42$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('recurring_booking_series, session_credits and session_credit_ledger exist', to_regclass('public.recurring_booking_series') is not null and to_regclass('public.session_credits') is not null and to_regclass('public.session_credit_ledger') is not null),
      ('the expiry hold and the coach''s expiry window exist (0280, 0209)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_credits' and column_name = 'expiry_hold_until') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'credit_expiry_days')),
      ('is_group_coach, is_org_admin_of_group, coach_time_zone and audit_watch exist (the new row security and functions use them)', exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_org_admin_of_group' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'coach_time_zone' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'audit_watch' and pronamespace = 'public'::regnamespace)),
      ('the notification types list exists and can be read (notifications_type_check)', exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)),
      ('0297 is not already applied (schedule_requests is not there yet)', to_regclass('public.schedule_requests') is null),
      ('0297 is not already applied (recurring_booking_series has no frozen_from yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring_booking_series' and column_name = 'frozen_from'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release L (schedule requests), step 42 (0297) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g42$;

-- ====================================================================================================
-- migration 0297_schedule_requests.sql
-- ====================================================================================================

-- Pause, freeze or cancel a client's weekly schedule (Ron, Oct 7). A client ASKS for one of three things on their weekly schedule (recurring_booking_series); the request
-- takes effect on the date they chose, by itself, unless the coach handles it first. Nothing here moves money and nothing takes or gives a session.
--
--  * schedule_requests: kind pause / freeze / cancel; effective_on (the LAST day the schedule still runs: the change applies once that day has ended in the schedule's
--    time zone); resume_on (freeze only: the first day back, at most 12 weeks after effective_on). Status pending, applying (claimed while the app changes the
--    schedule), applied, dismissed (the coach marked it handled), withdrawn (the client took it back). One OPEN request per schedule (pending or applying).
--    Read by the client who asked and the group's coaches and org admins; written only through the functions below.
--  * schedule_request_notes: the client's optional words (at most 500 characters). Only the group's coaches and org admins can read them: not the client's own screen
--    and never a notification, a push, a log line or an AI call.
--  * recurring_booking_series: frozen_from / frozen_until (a freeze is a pause with a resume date), and resume_claimed_at / resume_attempts / resume_error for the daily
--    job that restarts a freeze on its resume date.
--  * request_schedule_change / withdraw_schedule_request: the client (their own schedule only, three requests a day at most). dismiss_schedule_request: a coach or org
--    admin marks one handled WITHOUT changing the schedule.
--  * claim_schedule_request / claim_due_schedule_requests / finish_schedule_request: SERVER ONLY. The app changes the schedule (the existing pause / end engine, with the
--    service-role store), so the database only hands out the work and records the result: a request is claimed (compare and set), the app applies it, then it is finished.
--    A failed apply goes back to pending and is tried again on the next run, three times at most; the coach is told when it keeps failing. A claim older than 10 minutes
--    is reclaimed. A coach pressing Done on a request dated today or earlier is the same path ("processed early": the client is told).
--  * The credit clock: a FREEZE adds its length to the expiry of the client's unused sessions, using the expiry hold that already exists (0280). When the freeze starts the
--    hold becomes (the normal expiry, or the hold already there if later) plus the freeze length, but never more than 24 WEEKS beyond the normal expiry, counting every
--    freeze together (repeated freeze and restart cycles cannot stretch it). The days actually added are remembered on the schedule (frozen_hold_days). When the freeze ends
--    (a restart, an early restart by the coach, or a cancel) the hold is settled against the days the freeze really lasted: a late restart adds the extra days (same cap),
--    an early end or a cancel takes the unused days back off, never below the normal expiry. The window used is the longest among the group's coaches (the nightly job
--    reads the group's coach, not the schedule's). Nothing happens for a group with no expiry window. A trigger on recurring_booking_series does the settling whenever a
--    frozen schedule leaves 'paused', so the Resume button, the daily job, a cancel and any other caller are all covered, and a stale freeze can never restart a later,
--    ordinary pause. No existing function is changed.
--  * end_schedule_freeze / claim_due_freeze_resumes / fail_freeze_resume / note_schedule_resumed: SERVER ONLY, for the daily job and the Resume button.
--  * The notification type list gains schedule_request, schedule_applied and schedule_resumed (built from the live list, nothing dropped).
-- Needs 0210 and 0259 (the series), 0209 and 0280 (credit expiry and the hold), 0267 (the audit trail). Re-running replaces the functions again.

alter table public.recurring_booking_series
  add column if not exists frozen_from date,
  add column if not exists frozen_until date,
  add column if not exists resume_claimed_at timestamptz,
  add column if not exists resume_attempts int not null default 0,
  add column if not exists resume_error text;
alter table public.recurring_booking_series add column if not exists frozen_hold_days int not null default 0;
alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_frozen_hold_ok;
alter table public.recurring_booking_series add constraint recurring_booking_series_frozen_hold_ok check (frozen_hold_days >= 0 and frozen_hold_days <= 168);
alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_frozen_ok;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_frozen_ok check (frozen_until is null or (frozen_from is not null and frozen_until > frozen_from));

create table if not exists public.schedule_requests (
  id uuid primary key default uuid_generate_v4(),
  series_id uuid not null references public.recurring_booking_series(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null check (kind in ('pause', 'freeze', 'cancel')),
  effective_on date not null,
  resume_on date,
  status text not null default 'pending' check (status in ('pending', 'applying', 'applied', 'dismissed', 'withdrawn')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts int not null default 0,
  last_error text,
  applied_at timestamptz,
  applied_early boolean not null default false,
  dismissed_at timestamptz,
  dismissed_by uuid references public.profiles(id) on delete set null,
  withdrawn_at timestamptz,
  constraint schedule_requests_resume_ok check (
    (kind = 'freeze' and resume_on is not null and resume_on > effective_on and resume_on <= effective_on + 84)
    or (kind <> 'freeze' and resume_on is null)
  )
);
create unique index if not exists schedule_requests_one_open on public.schedule_requests (series_id) where status in ('pending', 'applying');
create index if not exists schedule_requests_group_open on public.schedule_requests (group_id) where status in ('pending', 'applying');
create index if not exists schedule_requests_athlete_recent on public.schedule_requests (athlete_id, created_at);

create table if not exists public.schedule_request_notes (
  request_id uuid primary key references public.schedule_requests(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 500)
);

alter table public.schedule_requests enable row level security;
drop policy if exists "schedule_requests_select_participants" on public.schedule_requests;
create policy "schedule_requests_select_participants" on public.schedule_requests for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));
-- No insert, update or delete policy for signed-in users: requests are created and decided only by the functions below.

alter table public.schedule_request_notes enable row level security;
drop policy if exists "schedule_request_notes_select_coaches" on public.schedule_request_notes;
create policy "schedule_request_notes_select_coaches" on public.schedule_request_notes for select
  to authenticated using (
    exists (
      select 1 from public.schedule_requests r
      where r.id = schedule_request_notes.request_id and (public.is_group_coach(r.group_id) or public.is_org_admin_of_group(r.group_id))
    )
  );

-- A request, its status and when it was decided are money-adjacent history: the audit trail records any later change.
drop trigger if exists schedule_requests_audit on public.schedule_requests;
create trigger schedule_requests_audit after insert or update on public.schedule_requests
  for each row execute function public.audit_watch('status,kind,effective_on,resume_on,applied_early', 'insert_too', 'id');

-- ---- notification types: the live list plus the three new ones ----
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['schedule_request', 'schedule_applied', 'schedule_resumed']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

-- ---- small helpers (server only) ----
-- Today's date in the schedule's own time zone (the schedule's, else the coach's, else New York). A time zone the database does not know is skipped, so one bad value
-- can never stop the daily run.
create or replace function public.schedule_local_today(p_timezone text, p_coach_id uuid)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tz text;
begin
  foreach v_tz in array array[nullif(btrim(p_timezone), ''), (select public.coach_time_zone(p_coach_id)), 'America/New_York'] loop
    if v_tz is null then
      continue;
    end if;
    begin
      return (now() at time zone v_tz)::date;
    exception when others then
      continue;
    end;
  end loop;
  return (now() at time zone 'UTC')::date;
end;
$function$;

-- Who to tell about a client's request: the coach on the schedule if they still coach the group, otherwise every current coach of the group.
create or replace function public.schedule_request_recipients(p_group_id uuid, p_coach_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select gm.profile_id from public.group_memberships gm
  where gm.group_id = p_group_id and gm.role = 'coach'
    and (gm.profile_id = p_coach_id or not exists (select 1 from public.group_memberships c where c.group_id = p_group_id and c.profile_id = p_coach_id and c.role = 'coach'));
$function$;

-- ---- the credit clock (server only) ----
-- The expiry window the nightly job uses for this client: it looks at the group's coaches, so the longest window among them (and the schedule's own coach) is used.
-- 0 means no expiry.
create or replace function public.schedule_expiry_window_days(p_group_id uuid, p_coach_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(max(coalesce(bp.credit_expiry_days, 0)), 0)::int
  from (
    select gm.profile_id as coach_id from public.group_memberships gm where gm.group_id = p_group_id and gm.role = 'coach'
    union
    select p_coach_id
  ) c
  left join public.coach_booking_policies bp on bp.coach_id = c.coach_id;
$function$;

-- A freeze adds days to the expiry of the client's unused sessions, through the expiry hold (0280): to the later of the normal expiry and the hold already there, but never
-- beyond 24 weeks (168 days) past the normal expiry, whatever the number of freezes. Returns the days actually added (0 when there is nothing to protect, the cap is
-- reached, or the new hold would already be in the past).
create or replace function public.extend_expiry_for_freeze(p_athlete_id uuid, p_group_id uuid, p_coach_id uuid, p_days integer, p_why text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_window int;
  v_balance int;
  v_granted timestamptz;
  v_hold timestamptz;
  v_expires timestamptz;
  v_base timestamptz;
  v_new timestamptz;
  v_added int;
begin
  if p_days is null or p_days <= 0 then
    return 0;
  end if;
  v_window := public.schedule_expiry_window_days(p_group_id, p_coach_id);
  if v_window <= 0 then
    return 0;
  end if;
  select balance, last_granted_at, expiry_hold_until into v_balance, v_granted, v_hold
  from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  if not found or coalesce(v_balance, 0) <= 0 or v_granted is null then
    return 0;
  end if;
  v_expires := v_granted + make_interval(days => v_window);
  v_base := greatest(coalesce(v_hold, v_expires), v_expires);
  v_new := least(v_base + make_interval(days => p_days), v_expires + interval '168 days');
  if v_new <= v_base or v_new <= now() then
    return 0;
  end if;
  v_added := round(extract(epoch from (v_new - v_base)) / 86400)::int;
  update public.session_credits set expiry_hold_until = v_new, updated_at = now() where athlete_id = p_athlete_id and group_id = p_group_id;
  insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note, created_by)
  values (p_athlete_id, p_group_id, 'adjusted', 0, v_balance,
    'Expiry held until ' || to_char(v_new, 'Mon FMDD, YYYY') || ': ' || coalesce(nullif(btrim(p_why), ''), 'schedule frozen') || ' (' || v_added::text || ' days)', null);
  return v_added;
end;
$function$;

-- The opposite: a freeze that ended early (or was cancelled) takes its unused days back off the hold, never below the normal expiry. When nothing is left beyond the normal
-- expiry the hold is removed. Returns the days taken off.
create or replace function public.shorten_expiry_after_freeze(p_athlete_id uuid, p_group_id uuid, p_coach_id uuid, p_days integer, p_why text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_window int;
  v_balance int;
  v_granted timestamptz;
  v_hold timestamptz;
  v_expires timestamptz;
  v_new timestamptz;
  v_removed int;
begin
  if p_days is null or p_days <= 0 then
    return 0;
  end if;
  v_window := public.schedule_expiry_window_days(p_group_id, p_coach_id);
  if v_window <= 0 then
    return 0;
  end if;
  select balance, last_granted_at, expiry_hold_until into v_balance, v_granted, v_hold
  from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  if not found or v_hold is null or v_granted is null then
    return 0;
  end if;
  v_expires := v_granted + make_interval(days => v_window);
  if v_hold <= v_expires then
    return 0;
  end if;
  v_new := v_hold - make_interval(days => p_days);
  if v_new <= v_expires then
    v_removed := round(extract(epoch from (v_hold - v_expires)) / 86400)::int;
    v_new := null;
  else
    v_removed := p_days;
  end if;
  update public.session_credits set expiry_hold_until = v_new, updated_at = now() where athlete_id = p_athlete_id and group_id = p_group_id;
  insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note, created_by)
  values (p_athlete_id, p_group_id, 'adjusted', 0, coalesce(v_balance, 0),
    case when v_new is null then 'Expiry hold removed: ' else 'Expiry held until ' || to_char(v_new, 'Mon FMDD, YYYY') || ': ' end
      || coalesce(nullif(btrim(p_why), ''), 'schedule freeze ended') || ' (' || v_removed::text || ' days)', null);
  return v_removed;
end;
$function$;

-- Settles a freeze against what really happened: the days it lasted against the days that were added to the hold. A late end adds the difference (same cap), an early end
-- or a cancel takes it back off. Returns the signed change in days (positive added, negative taken off).
create or replace function public.settle_schedule_freeze(p_athlete_id uuid, p_group_id uuid, p_coach_id uuid, p_from date, p_ended_on date, p_hold_days integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actual int := greatest(coalesce(p_ended_on - p_from, 0), 0);
  v_diff int := greatest(coalesce(p_ended_on - p_from, 0), 0) - coalesce(p_hold_days, 0);
begin
  if v_diff > 0 then
    return public.extend_expiry_for_freeze(p_athlete_id, p_group_id, p_coach_id, v_diff, 'the freeze ran ' || v_actual::text || ' days');
  elsif v_diff < 0 then
    return -public.shorten_expiry_after_freeze(p_athlete_id, p_group_id, p_coach_id, -v_diff, 'the freeze ended after ' || v_actual::text || ' days');
  end if;
  return 0;
end;
$function$;

-- Whenever a FROZEN schedule leaves 'paused' (restarted by the daily job or by the coach's Resume button, ended, cancelled) the freeze is settled and its dates cleared in the
-- same update; a status change that is not part of a new freeze also clears any stale dates, so an old freeze can never restart a later, ordinary pause. The update that
-- applies a new freeze sets frozen_from itself and is left alone.
create or replace function public.recurring_series_freeze_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.frozen_from is not null and new.status is distinct from old.status and new.frozen_from is not distinct from old.frozen_from then
    if old.status = 'paused' and new.status <> 'paused' then
      perform public.settle_schedule_freeze(old.athlete_id, old.group_id, old.coach_id, old.frozen_from,
        public.schedule_local_today(old.timezone, old.coach_id), old.frozen_hold_days);
    end if;
    new.frozen_from := null;
    new.frozen_until := null;
    new.frozen_hold_days := 0;
    new.resume_claimed_at := null;
    new.resume_attempts := 0;
    new.resume_error := null;
  end if;
  return new;
end;
$function$;
drop trigger if exists recurring_series_freeze_guard on public.recurring_booking_series;
create trigger recurring_series_freeze_guard before update on public.recurring_booking_series
  for each row execute function public.recurring_series_freeze_guard();

-- ---- the client asks ----
create or replace function public.request_schedule_change(p_series_id uuid, p_kind text, p_effective_on date, p_resume_on date default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.recurring_booking_series%rowtype;
  v_today date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  v_name text;
  v_to uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  select * into s from public.recurring_booking_series where id = p_series_id for update;
  -- The same answer for "not found" and "someone else's", so schedule ids cannot be probed.
  if s.id is null or s.athlete_id <> auth.uid() then
    raise exception 'not authorized';
  end if;
  if p_kind is null or p_kind not in ('pause', 'freeze', 'cancel') then
    raise exception 'choose pause, freeze or cancel';
  end if;
  if p_kind = 'cancel' then
    if s.status not in ('active', 'paused') then
      raise exception 'this schedule has already ended';
    end if;
  elsif s.status <> 'active' then
    raise exception 'this schedule is already paused or has ended';
  end if;

  v_today := public.schedule_local_today(s.timezone, s.coach_id);
  if p_effective_on is null or p_effective_on < v_today then
    raise exception 'choose today or a later date';
  end if;
  if p_effective_on > v_today + 180 then
    raise exception 'choose a date within the next six months';
  end if;
  if p_kind = 'freeze' then
    if p_resume_on is null then
      raise exception 'choose the day you want to start again';
    end if;
    if p_resume_on <= p_effective_on then
      raise exception 'the day you start again must be after the freeze begins';
    end if;
    if p_resume_on > p_effective_on + 84 then
      raise exception 'a freeze can last up to 12 weeks';
    end if;
  elsif p_resume_on is not null then
    raise exception 'only a freeze has a day to start again';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'please keep your note under 500 characters';
  end if;

  -- Lock the client's row so two requests at the same moment cannot both pass the daily limit.
  perform 1 from public.profiles where id = s.athlete_id for update;
  if (select count(*) from public.schedule_requests r where r.athlete_id = s.athlete_id and r.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'you have sent a few requests today: message your coach';
  end if;

  begin
    insert into public.schedule_requests (series_id, athlete_id, coach_id, group_id, kind, effective_on, resume_on)
    values (s.id, s.athlete_id, s.coach_id, s.group_id, p_kind, p_effective_on, p_resume_on)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'you already have a request waiting for this schedule';
  end;
  if v_note is not null then
    insert into public.schedule_request_notes (request_id, note) values (v_id, v_note);
  end if;

  select full_name into v_name from public.profiles where id = s.athlete_id;
  for v_to in select * from public.schedule_request_recipients(s.group_id, s.coach_id) loop
    -- Fixed wording only: never the kind of request and never the note.
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_to, s.group_id, 'schedule_request', coalesce(nullif(btrim(v_name), ''), 'A client') || ' sent a schedule request.', '/dashboard');
  end loop;
  return v_id;
end;
$function$;

create or replace function public.withdraw_schedule_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.schedule_requests%rowtype;
begin
  select * into r from public.schedule_requests where id = p_request_id for update;
  if r.id is null or auth.uid() is distinct from r.athlete_id then
    raise exception 'not authorized';
  end if;
  if r.status = 'applying' and r.claimed_at > now() - interval '10 minutes' then
    raise exception 'your coach is already changing your schedule';
  end if;
  if r.status not in ('pending', 'applying') then
    raise exception 'this request was already handled';
  end if;
  update public.schedule_requests set status = 'withdrawn', withdrawn_at = now() where id = r.id;
end;
$function$;

-- The coach (or an org owner or admin) marks a request handled WITHOUT changing the schedule (they sorted it out by message or by hand).
create or replace function public.dismiss_schedule_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.schedule_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  select * into r from public.schedule_requests where id = p_request_id for update;
  if r.id is null or not (public.is_group_coach(r.group_id) or public.is_org_admin_of_group(r.group_id)) then
    raise exception 'not authorized';
  end if;
  if r.status = 'applying' and r.claimed_at > now() - interval '10 minutes' then
    raise exception 'this request is being applied right now';
  end if;
  if r.status not in ('pending', 'applying') then
    raise exception 'this request was already handled';
  end if;
  update public.schedule_requests set status = 'dismissed', dismissed_at = now(), dismissed_by = auth.uid() where id = r.id;
end;
$function$;

-- ---- the server applies (service role only) ----
-- One request, claimed for the app to apply. p_by_coach: a coach pressed Done, which is allowed only on or after the chosen date; 'early' is true when the chosen day has not
-- ended yet (the client is told it was processed early).
create or replace function public.claim_schedule_request(p_request_id uuid, p_by_coach boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.schedule_requests%rowtype;
  s public.recurring_booking_series%rowtype;
  v_today date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  select * into r from public.schedule_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'request not found';
  end if;
  if r.status = 'applying' and r.claimed_at > now() - interval '10 minutes' then
    raise exception 'this request is being applied right now';
  end if;
  if r.status not in ('pending', 'applying') then
    raise exception 'this request was already handled';
  end if;
  select * into s from public.recurring_booking_series where id = r.series_id;
  v_today := public.schedule_local_today(s.timezone, s.coach_id);
  if p_by_coach and v_today < r.effective_on then
    raise exception 'this request is dated % and applies by itself after that day', to_char(r.effective_on, 'Mon FMDD');
  end if;
  update public.schedule_requests set status = 'applying', claimed_at = now(), attempts = attempts + 1 where id = r.id;
  return jsonb_build_object(
    'request_id', r.id, 'series_id', r.series_id, 'kind', r.kind, 'effective_on', r.effective_on, 'resume_on', r.resume_on,
    'athlete_id', r.athlete_id, 'group_id', r.group_id, 'early', v_today <= r.effective_on
  );
end;
$function$;

-- Every request whose chosen day has ended, claimed for the daily job. Three tries at most; a claim older than 10 minutes is reclaimed.
create or replace function public.claim_due_schedule_requests(p_limit integer default 50)
returns setof jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  for r in
    select sr.* from public.schedule_requests sr
    join public.recurring_booking_series s on s.id = sr.series_id
    where (sr.status = 'pending' or (sr.status = 'applying' and sr.claimed_at < now() - interval '10 minutes'))
      and sr.attempts < 3
      and public.schedule_local_today(s.timezone, s.coach_id) > sr.effective_on
    order by sr.effective_on, sr.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update of sr skip locked
  loop
    update public.schedule_requests set status = 'applying', claimed_at = now(), attempts = attempts + 1 where id = r.id;
    return next jsonb_build_object(
      'request_id', r.id, 'series_id', r.series_id, 'kind', r.kind, 'effective_on', r.effective_on, 'resume_on', r.resume_on,
      'athlete_id', r.athlete_id, 'group_id', r.group_id, 'early', false
    );
  end loop;
end;
$function$;

-- The app reports the result. p_ok false puts the request back to pending (with a short reason for the coach); p_by_system says the daily job applied it (the coach is
-- told too); p_early says it was applied before its chosen day ended (the client is told so). The app has already paused the schedule for a freeze.
create or replace function public.finish_schedule_request(p_request_id uuid, p_ok boolean, p_early boolean default false, p_by_system boolean default false, p_error text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.schedule_requests%rowtype;
  s public.recurring_booking_series%rowtype;
  v_series uuid;
  v_today date;
  v_name text;
  v_to uuid;
  v_client_body text;
  v_tz_date text;
  v_added int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  -- The schedule is locked before the request (the order request_schedule_change uses), so the two can never wait on each other.
  select series_id into v_series from public.schedule_requests where id = p_request_id;
  if v_series is null then
    raise exception 'request not found';
  end if;
  select * into s from public.recurring_booking_series where id = v_series for update;
  select * into r from public.schedule_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'request not found';
  end if;
  if r.status <> 'applying' then
    raise exception 'this request is not being applied';
  end if;
  select full_name into v_name from public.profiles where id = r.athlete_id;

  if not coalesce(p_ok, false) then
    update public.schedule_requests
      set status = 'pending', claimed_at = null, last_error = left(coalesce(nullif(btrim(p_error), ''), 'could not be applied'), 200)
      where id = r.id;
    -- The coach is told once, when the third try fails (a coach pressing Done again does not repeat it).
    if r.attempts = 3 then
      for v_to in select * from public.schedule_request_recipients(r.group_id, s.coach_id) loop
        insert into public.notifications (profile_id, group_id, type, body, link_path)
        values (v_to, r.group_id, 'schedule_applied',
          'A schedule request from ' || coalesce(nullif(btrim(v_name), ''), 'a client') || ' could not be applied automatically. Open it and change their schedule yourself.', '/dashboard');
      end loop;
    end if;
    return;
  end if;

  v_today := public.schedule_local_today(s.timezone, s.coach_id);
  update public.schedule_requests
    set status = 'applied', applied_at = now(), applied_early = coalesce(p_early, false), last_error = null
    where id = r.id;

  -- A freeze whose restart day has already come has nothing to freeze: the schedule was left running and the client is told so.
  if r.kind = 'freeze' and r.resume_on <= v_today then
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.athlete_id, r.group_id, 'schedule_applied', 'The freeze you asked for had already ended, so your weekly schedule was left as it is.', '/groups/' || r.group_id::text || '/my-schedule');
    return;
  end if;

  if r.kind = 'freeze' then
    v_added := public.extend_expiry_for_freeze(r.athlete_id, r.group_id, s.coach_id, r.resume_on - v_today, 'schedule frozen until ' || to_char(r.resume_on, 'Mon FMDD'));
    update public.recurring_booking_series
      set frozen_from = v_today, frozen_until = r.resume_on, frozen_hold_days = coalesce(v_added, 0), resume_claimed_at = null, resume_attempts = 0, resume_error = null
      where id = r.series_id;
  elsif r.kind = 'cancel' then
    -- A frozen schedule that is cancelled ends its freeze today (normally the trigger on the schedule already settled it when the schedule ended).
    perform public.end_schedule_freeze(r.series_id, v_today);
  end if;

  v_tz_date := to_char(r.effective_on, 'Mon FMDD');
  v_client_body := case r.kind
    when 'pause' then case when p_early then 'Your coach paused your weekly schedule now, ahead of ' || v_tz_date || '. Your coach will be in touch about starting again.'
                            else 'Your weekly schedule is paused as you asked. Your coach will be in touch about starting again.' end
    when 'freeze' then case when p_early then 'Your coach froze your weekly schedule now, ahead of ' || v_tz_date || '. It starts again ' || to_char(r.resume_on, 'Mon FMDD') || '.'
                             else 'Your weekly schedule is frozen as you asked. It starts again ' || to_char(r.resume_on, 'Mon FMDD') || '.' end
    else case when p_early then 'Your coach ended your weekly schedule now, ahead of ' || v_tz_date || '. Thank you for training with us.'
              else 'Your weekly schedule has ended as you asked. Thank you for training with us.' end
  end;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (r.athlete_id, r.group_id, 'schedule_applied', v_client_body, '/groups/' || r.group_id::text || '/my-schedule');

  if p_by_system then
    for v_to in select * from public.schedule_request_recipients(r.group_id, s.coach_id) loop
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (v_to, r.group_id, 'schedule_applied',
        coalesce(nullif(btrim(v_name), ''), 'A client') || '''s schedule change took effect as they asked.', '/dashboard');
    end loop;
  end if;
end;
$function$;

-- ---- freezes: the daily job and the Resume button (server only) ----
-- Ends a freeze without changing the schedule's status (the trigger above does the same when the status changes): settles the hold against the days the freeze really
-- lasted and clears the freeze dates. Safe to call twice. Returns the signed change in days.
create or replace function public.end_schedule_freeze(p_series_id uuid, p_ended_on date default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.recurring_booking_series%rowtype;
  v_end date;
  v_diff int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  select * into s from public.recurring_booking_series where id = p_series_id for update;
  if s.id is null then
    raise exception 'schedule not found';
  end if;
  if s.frozen_from is null then
    update public.recurring_booking_series set resume_claimed_at = null, resume_attempts = 0, resume_error = null
      where id = s.id and (resume_claimed_at is not null or resume_attempts <> 0 or resume_error is not null);
    return 0;
  end if;
  v_end := coalesce(p_ended_on, public.schedule_local_today(s.timezone, s.coach_id));
  v_diff := public.settle_schedule_freeze(s.athlete_id, s.group_id, s.coach_id, s.frozen_from, v_end, s.frozen_hold_days);
  update public.recurring_booking_series
    set frozen_from = null, frozen_until = null, frozen_hold_days = 0, resume_claimed_at = null, resume_attempts = 0, resume_error = null
    where id = s.id;
  return v_diff;
end;
$function$;

-- Frozen schedules whose resume day has come, claimed for the daily job. Three tries at most; a claim older than 10 minutes is reclaimed.
create or replace function public.claim_due_freeze_resumes(p_limit integer default 50)
returns table(series_id uuid, athlete_id uuid, group_id uuid, coach_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  for r in
    select s.id, s.athlete_id as a, s.group_id as g, s.coach_id as c from public.recurring_booking_series s
    where s.status = 'paused' and s.frozen_until is not null
      and s.frozen_until <= public.schedule_local_today(s.timezone, s.coach_id)
      and (s.resume_claimed_at is null or s.resume_claimed_at < now() - interval '10 minutes')
      and s.resume_attempts < 3
    order by s.frozen_until
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update of s skip locked
  loop
    update public.recurring_booking_series set resume_claimed_at = now() where id = r.id;
    series_id := r.id; athlete_id := r.a; group_id := r.g; coach_id := r.c;
    return next;
  end loop;
end;
$function$;

-- A resume that failed: the claim is released, the try is counted, and the coach is told the first time and again when it has failed three times.
create or replace function public.fail_freeze_resume(p_series_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.recurring_booking_series%rowtype;
  v_name text;
  v_to uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  select * into s from public.recurring_booking_series where id = p_series_id for update;
  if s.id is null then
    raise exception 'schedule not found';
  end if;
  update public.recurring_booking_series
    set resume_claimed_at = null, resume_attempts = resume_attempts + 1, resume_error = left(coalesce(nullif(btrim(p_error), ''), 'could not be restarted'), 200)
    where id = s.id;
  if s.resume_attempts + 1 in (1, 3) then
    select full_name into v_name from public.profiles where id = s.athlete_id;
    for v_to in select * from public.schedule_request_recipients(s.group_id, s.coach_id) loop
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (v_to, s.group_id, 'schedule_resumed',
        coalesce(nullif(btrim(v_name), ''), 'A client') || '''s frozen schedule could not be restarted automatically. Open their profile and restart it.',
        '/groups/' || s.group_id::text || '/athletes/' || s.athlete_id::text);
    end loop;
  end if;
end;
$function$;

-- A freeze ended and the schedule is running again: tell the coach (with how many sessions were booked and how many dates could not be) and the client.
create or replace function public.note_schedule_resumed(p_series_id uuid, p_booked integer, p_not_booked integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.recurring_booking_series%rowtype;
  v_name text;
  v_to uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  select * into s from public.recurring_booking_series where id = p_series_id;
  if s.id is null then
    raise exception 'schedule not found';
  end if;
  select full_name into v_name from public.profiles where id = s.athlete_id;
  for v_to in select * from public.schedule_request_recipients(s.group_id, s.coach_id) loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_to, s.group_id, 'schedule_resumed',
      coalesce(nullif(btrim(v_name), ''), 'A client') || '''s weekly schedule started again: ' || greatest(coalesce(p_booked, 0), 0)::text || ' sessions booked'
        || case when coalesce(p_not_booked, 0) > 0 then ', ' || p_not_booked::text || ' dates could not be booked.' else '.' end,
      '/groups/' || s.group_id::text || '/athletes/' || s.athlete_id::text);
  end loop;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (s.athlete_id, s.group_id, 'schedule_resumed', 'Your weekly schedule is back on. See you soon.', '/groups/' || s.group_id::text || '/my-schedule');
end;
$function$;

-- ---- who may run what ----
revoke all on function public.request_schedule_change(uuid, text, date, date, text) from public, anon;
grant execute on function public.request_schedule_change(uuid, text, date, date, text) to authenticated, service_role;
revoke all on function public.withdraw_schedule_request(uuid) from public, anon;
grant execute on function public.withdraw_schedule_request(uuid) to authenticated, service_role;
revoke all on function public.dismiss_schedule_request(uuid) from public, anon;
grant execute on function public.dismiss_schedule_request(uuid) to authenticated, service_role;

revoke all on function public.schedule_local_today(text, uuid) from public, anon, authenticated;
grant execute on function public.schedule_local_today(text, uuid) to service_role;
revoke all on function public.schedule_request_recipients(uuid, uuid) from public, anon, authenticated;
grant execute on function public.schedule_request_recipients(uuid, uuid) to service_role;
revoke all on function public.extend_expiry_for_freeze(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.extend_expiry_for_freeze(uuid, uuid, uuid, integer, text) to service_role;
revoke all on function public.schedule_expiry_window_days(uuid, uuid) from public, anon, authenticated;
grant execute on function public.schedule_expiry_window_days(uuid, uuid) to service_role;
revoke all on function public.shorten_expiry_after_freeze(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.shorten_expiry_after_freeze(uuid, uuid, uuid, integer, text) to service_role;
revoke all on function public.settle_schedule_freeze(uuid, uuid, uuid, date, date, integer) from public, anon, authenticated;
grant execute on function public.settle_schedule_freeze(uuid, uuid, uuid, date, date, integer) to service_role;
revoke all on function public.claim_schedule_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_schedule_request(uuid, boolean) to service_role;
revoke all on function public.claim_due_schedule_requests(integer) from public, anon, authenticated;
grant execute on function public.claim_due_schedule_requests(integer) to service_role;
revoke all on function public.finish_schedule_request(uuid, boolean, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_schedule_request(uuid, boolean, boolean, boolean, text) to service_role;
revoke all on function public.end_schedule_freeze(uuid, date) from public, anon, authenticated;
grant execute on function public.end_schedule_freeze(uuid, date) to service_role;
revoke all on function public.claim_due_freeze_resumes(integer) from public, anon, authenticated;
grant execute on function public.claim_due_freeze_resumes(integer) to service_role;
revoke all on function public.fail_freeze_resume(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_freeze_resume(uuid, text) to service_role;
revoke all on function public.note_schedule_resumed(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.note_schedule_resumed(uuid, integer, integer) to service_role;

-- Defence in depth: signed-in people can only READ these two tables (row security decides which rows); every write goes through the functions above.
revoke insert, update, delete, truncate on public.schedule_requests from anon, authenticated;
revoke insert, update, delete, truncate on public.schedule_request_notes from anon, authenticated;
revoke all on public.schedule_request_notes from anon;
revoke all on public.schedule_requests from anon;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 42 (0297)' as step, '0297 pause' as what, not ((to_regclass('public.schedule_requests') is null) and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring_booking_series' and column_name = 'frozen_from'))) as in_place
) as result order by step;
