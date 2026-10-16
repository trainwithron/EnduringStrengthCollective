-- RELEASE CK (A TEXT STOP STICKS TO THE PHONE NUMBER; SHARED LISTS OWNER-ONLY; PRIVATE CLIENTS STAY PRIVATE FROM ORGANIZATION ADMINS; TEN MORE TABLES REFUSE NON-MEMBER ROWS; AUDIT TRAIL FOR ACCESS-CHANGING ROWS; RUN IN ORDER 134, 135, BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 134, 135 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 134: Nothing changes on screen. Numbers that already stopped are carried over into a new private list. From now on a STOP reply is remembered for the number even if nobody had opted in with it, a number on the list cannot be used to opt in (the person is told to text START from it), and no text is sent to it.
-- AFTER STEP 135: A coach can no longer change or delete another coach's food mappings or movement tags (they can still add their own). A client marked private from the organization is no longer visible to organization admins in their billing rate, set-aside and reinstated-session records, schedule requests, or (for a private one-on-one space) the space itself, its posts and its events, and an admin can no longer set such a client aside or hold, give back or take back their expired sessions. Ten more client tables refuse a row about someone who is not in the group; a progress photo must sit in its owner's own folder; and changes to organizations, memberships, consent, parent links, kiosk PINs, API keys and legal acceptances are written to the audit trail (never a PIN or key value).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CK (a text STOP sticks to the phone number; shared lists owner-only; private clients stay private from organization admins; ten more tables refuse non-member rows; audit trail for access-changing rows; run in order 134, 135, BEFORE the code that goes with it is live), step 134: 0383 A text STOP is remembered for the phone number: nobody can opt in with it, and no text goes to it, until it texts START
do $g134$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0383 is not already applied (the stopped-number list is not there yet)', to_regclass('public.sms_suppressed_numbers') is null),
      ('the text consent table and functions exist', to_regclass('public.athlete_sms_consent') is not null and to_regprocedure('public.record_sms_stop(text)') is not null and to_regprocedure('public.set_sms_consent(text, boolean, boolean, text)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CK (a text STOP sticks to the phone number; shared lists owner-only; private clients stay private from organization admins; ten more tables refuse non-member rows; audit trail for access-changing rows; run in order 134, 135, BEFORE the code that goes with it is live), step 134 (0383) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g134$;

-- ====================================================================================================
-- migration 0383_sms_number_suppression.sql
-- ====================================================================================================

-- Release CK: a text STOP now sticks to the PHONE NUMBER, not to a client's consent row. Before, a STOP from a number nobody had opted in (or that was later moved to another client, or re-entered under a new number) only wrote a log line,
-- so the next person to opt in with that number started receiving texts again. Now:
--   * sms_suppressed_numbers holds every number that has replied STOP (the server writes it; nobody signed in can read or write it);
--   * START removes the number again;
--   * a number on the list is never sent to, and nobody can opt in with it until it texts START;
--   * numbers that already stopped are copied in from the existing records (opt-outs and STOP events with no later START).
-- Re-runnable.
create table if not exists public.sms_suppressed_numbers (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  stopped_at timestamptz not null default now()
);
alter table public.sms_suppressed_numbers enable row level security;
revoke all on public.sms_suppressed_numbers from anon, authenticated;

insert into public.sms_suppressed_numbers (phone_e164, stopped_at)
select phone_e164, coalesce(opted_out_at, now()) from public.athlete_sms_consent where opted_out_at is not null
on conflict (phone_e164) do nothing;

insert into public.sms_suppressed_numbers (phone_e164, stopped_at)
select e.phone_e164, max(e.created_at)
from public.sms_consent_events e
where e.event = 'stop'
  and e.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  and not exists (select 1 from public.sms_consent_events s where s.phone_e164 = e.phone_e164 and s.event = 'start' and s.created_at > e.created_at)
group by e.phone_e164
on conflict (phone_e164) do nothing;

create or replace function public.record_sms_stop(p_phone text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count int := 0;
  r record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;

  -- The number is remembered whether or not anyone has opted in with it.
  insert into public.sms_suppressed_numbers (phone_e164, stopped_at) values (p_phone, now())
  on conflict (phone_e164) do update set stopped_at = now();

  for r in
    update public.athlete_sms_consent
       set opted_out_at = now(), updated_at = now()
     where phone_e164 = p_phone and opted_out_at is null
    returning athlete_id
  loop
    v_count := v_count + 1;
    insert into public.sms_consent_events (athlete_id, phone_e164, event, source)
    values (r.athlete_id, p_phone, 'stop', 'sms_reply');
  end loop;

  if v_count = 0 then
    insert into public.sms_consent_events (athlete_id, phone_e164, event, source)
    values (null, p_phone, 'stop', 'sms_reply');
  end if;
  return v_count;
end;
$function$;

create or replace function public.record_sms_start(p_phone text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count int := 0;
  r record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;

  delete from public.sms_suppressed_numbers where phone_e164 = p_phone;

  for r in
    update public.athlete_sms_consent
       set opted_out_at = null, updated_at = now()
     where phone_e164 = p_phone and opted_out_at is not null
    returning athlete_id
  loop
    v_count := v_count + 1;
    insert into public.sms_consent_events (athlete_id, phone_e164, event, source)
    values (r.athlete_id, p_phone, 'start', 'sms_reply');
  end loop;
  return v_count;
end;
$function$;

create or replace function public.sms_consent_for_dispatch(p_athlete_id uuid, p_scope text)
 returns table(phone_e164 text, allowed boolean, reason text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  c public.athlete_sms_consent%rowtype;
  v_dob date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;
  if p_scope not in ('appointments', 'announcements') then
    return query select null::text, false, 'bad_scope'::text;
    return;
  end if;

  select * into c from public.athlete_sms_consent where athlete_id = p_athlete_id;
  if not found then
    return query select null::text, false, 'no_consent'::text;
    return;
  end if;
  if (p_scope = 'appointments' and not c.appointments)
     or (p_scope = 'announcements' and not c.announcements) then
    return query select c.phone_e164, false, 'no_consent'::text;
    return;
  end if;
  if c.opted_out_at is not null or exists (select 1 from public.sms_suppressed_numbers s where s.phone_e164 = c.phone_e164) then
    return query select c.phone_e164, false, 'opted_out'::text;
    return;
  end if;

  select date_of_birth into v_dob from public.client_intake where athlete_id = p_athlete_id;
  if v_dob is not null and (v_dob + interval '13 years')::date > current_date then
    if not coalesce((select verified from public.minor_consent where athlete_id = p_athlete_id), false) then
      return query select c.phone_e164, false, 'minor_no_guardian_consent'::text;
      return;
    end if;
  end if;

  return query select c.phone_e164, true, null::text;
end;
$function$;

create or replace function public.set_sms_consent(p_phone text, p_appointments boolean, p_announcements boolean, p_disclosure_version text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_existing public.athlete_sms_consent%rowtype;
  v_phone_changed boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter a valid mobile number.';
  end if;
  if p_disclosure_version is null or length(trim(p_disclosure_version)) = 0 then
    raise exception 'Missing disclosure version';
  end if;

  -- A number that has replied STOP stays blocked, whoever enters it and whatever their earlier settings were, until that number texts START.
  if (p_appointments or p_announcements) and exists (select 1 from public.sms_suppressed_numbers s where s.phone_e164 = p_phone) then
    raise exception 'That number replied STOP to our texts. Text START from it to resume them first.';
  end if;

  select * into v_existing from public.athlete_sms_consent where athlete_id = v_uid;

  if found and v_existing.phone_e164 <> p_phone then
    v_phone_changed := true;
    insert into public.sms_consent_events (athlete_id, phone_e164, event, source, disclosure_version)
    values (v_uid, v_existing.phone_e164, 'phone_changed', 'settings', p_disclosure_version);
  end if;

  if found and not v_phone_changed and v_existing.opted_out_at is not null
     and (p_appointments or p_announcements) then
    raise exception 'You replied STOP to our texts. Text START to resume them first.';
  end if;

  insert into public.athlete_sms_consent (
    athlete_id, phone_e164, appointments, announcements, consented_at, opted_out_at, disclosure_version, updated_at
  )
  values (v_uid, p_phone, p_appointments, p_announcements, now(), null, p_disclosure_version, now())
  on conflict (athlete_id) do update set
    phone_e164 = excluded.phone_e164,
    appointments = excluded.appointments,
    announcements = excluded.announcements,
    consented_at = case
      when (excluded.appointments or excluded.announcements) then now()
      else public.athlete_sms_consent.consented_at
    end,
    opted_out_at = case
      when v_phone_changed then null
      else public.athlete_sms_consent.opted_out_at
    end,
    disclosure_version = excluded.disclosure_version,
    updated_at = now();

  insert into public.sms_consent_events (
    athlete_id, phone_e164, event, appointments, announcements, source, disclosure_version
  )
  values (
    v_uid, p_phone,
    case when p_appointments or p_announcements then 'opt_in' else 'opt_out' end,
    p_appointments, p_announcements, 'settings', p_disclosure_version
  );
end;
$function$;

-- ===== Release CK (a text STOP sticks to the phone number; shared lists owner-only; private clients stay private from organization admins; ten more tables refuse non-member rows; audit trail for access-changing rows; run in order 134, 135, BEFORE the code that goes with it is live), step 135: 0384 Privacy closures: shared lists changed only by their owner, private clients stay private from organization admins, ten more client tables refuse a row about a non-member, progress photos in the owner's folder, an audit trail for access-changing rows
do $g135$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0384 is not already applied (the private-space helper is not there yet)', to_regprocedure('public.is_group_private_from_org(uuid)') is null),
      ('the tables and helpers it builds on exist', to_regclass('public.builtin_ingredient_usda_mappings') is not null and to_regclass('public.exercise_biomech_tags') is not null and to_regclass('public.client_inactive') is not null and to_regclass('public.schedule_requests') is not null and to_regclass('public.progress_photos') is not null and to_regprocedure('public.is_client_private_from_org(uuid, uuid)') is not null and to_regprocedure('public.enforce_athlete_in_group()') is not null and to_regprocedure('public.audit_watch()') is not null),
      ('every existing progress photo already sits in its owner''s folder (so the new rule fits what is saved)', not exists (select 1 from public.progress_photos where storage_path not like athlete_id::text || '/%'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CK (a text STOP sticks to the phone number; shared lists owner-only; private clients stay private from organization admins; ten more tables refuse non-member rows; audit trail for access-changing rows; run in order 134, 135, BEFORE the code that goes with it is live), step 135 (0384) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g135$;

-- ====================================================================================================
-- migration 0384_privacy_closures.sql
-- ====================================================================================================

-- Release CK: privacy closures.
--  1. Two lists every coach shares (which food a built-in ingredient means, which movement tags an exercise has) could be rewritten or emptied by ANY coach, changing what every other coach and client sees.
--     Now a coach can add a row and change or delete only their own rows; the platform admin can change any. (The screens that add rows keep working.)
--  2. A client who is private from the organization (private_from_org) stays private from organization admins in the places the earlier rule missed: their billing rate, set-aside and reinstated-session records,
--     schedule requests and notes, and (for a private one-on-one space) the space itself, its posts and its events; and an admin can no longer run the set-aside / expiry-hold / reinstate actions on them.
-- Re-runnable.

-- 1. Shared reference lists -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "builtin_ingredient_usda_mappings_write_coach" on public.builtin_ingredient_usda_mappings;
create policy "builtin_ingredient_usda_mappings_insert_coach" on public.builtin_ingredient_usda_mappings for insert to authenticated
  with check (mapped_by = (select auth.uid()) and exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));
create policy "builtin_ingredient_usda_mappings_update_own" on public.builtin_ingredient_usda_mappings for update to authenticated
  using (mapped_by = (select auth.uid()) or public.is_platform_admin())
  with check (mapped_by = (select auth.uid()) or public.is_platform_admin());
create policy "builtin_ingredient_usda_mappings_delete_own" on public.builtin_ingredient_usda_mappings for delete to authenticated
  using (mapped_by = (select auth.uid()) or public.is_platform_admin());

drop policy if exists "exercise_biomech_tags_write_coach" on public.exercise_biomech_tags;
create policy "exercise_biomech_tags_insert_coach" on public.exercise_biomech_tags for insert to authenticated
  with check (created_by = (select auth.uid()) and exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));
create policy "exercise_biomech_tags_update_own" on public.exercise_biomech_tags for update to authenticated
  using (created_by = (select auth.uid()) or public.is_platform_admin())
  with check (created_by = (select auth.uid()) or public.is_platform_admin());
create policy "exercise_biomech_tags_delete_own" on public.exercise_biomech_tags for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_platform_admin());

-- 2. Private clients stay private from organization admins ---------------------------------------------------------------------------------------------------------------------------------
-- A one-on-one space whose client is private from the organization.
create or replace function public.is_group_private_from_org(_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.groups g
    join public.group_memberships m on m.group_id = g.id and m.role = 'athlete'
    where g.id = _group_id and g.group_kind = 'one_on_one' and m.private_from_org = true
  );
$$;
revoke all on function public.is_group_private_from_org(uuid) from public, anon;
grant execute on function public.is_group_private_from_org(uuid) to authenticated, service_role;

drop policy if exists "client_billing_rates_org_admin_select" on public.client_billing_rates;
create policy "client_billing_rates_org_admin_select" on public.client_billing_rates for select to authenticated
  using (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id));

drop policy if exists "client_inactive_select_coach" on public.client_inactive;
create policy "client_inactive_select_coach" on public.client_inactive for select to authenticated
  using (public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_client_private_from_org(group_id, athlete_id)));

drop policy if exists "client_inactive_events_select_coach" on public.client_inactive_events;
create policy "client_inactive_events_select_coach" on public.client_inactive_events for select to authenticated
  using (public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_client_private_from_org(group_id, athlete_id)));

drop policy if exists "schedule_requests_select_participants" on public.schedule_requests;
create policy "schedule_requests_select_participants" on public.schedule_requests for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_client_private_from_org(group_id, athlete_id)));

drop policy if exists "schedule_request_notes_select_coaches" on public.schedule_request_notes;
create policy "schedule_request_notes_select_coaches" on public.schedule_request_notes for select to authenticated
  using (exists (
    select 1 from public.schedule_requests r
    where r.id = schedule_request_notes.request_id
      and (public.is_group_coach(r.group_id) or (public.is_org_admin_of_group(r.group_id) and not public.is_client_private_from_org(r.group_id, r.athlete_id)))
  ));

drop policy if exists "groups_select_members_or_org_admin" on public.groups;
create policy "groups_select_members_or_org_admin" on public.groups for select to authenticated
  using (public.is_group_member(id) or (public.is_org_admin_of_group(id) and not public.is_group_private_from_org(id)));

drop policy if exists "posts_select_members" on public.posts;
create policy "posts_select_members" on public.posts for select to authenticated
  using (public.is_group_member(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id)));

drop policy if exists "posts_delete_own_or_coach" on public.posts;
create policy "posts_delete_own_or_coach" on public.posts for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id)));

drop policy if exists "group_sessions_select_event_member" on public.group_sessions;
create policy "group_sessions_select_event_member" on public.group_sessions for select to authenticated
  using ((kind = 'event') and (public.is_group_member(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id))));

-- The actions an organization admin could still run on a private client. A coach of the group is unchanged.
create or replace function public.set_client_inactive(p_athlete_id uuid, p_group_id uuid, p_inactive boolean, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete') then
    raise exception 'that client is not in this group';
  end if;
  if p_inactive then
    if not exists (select 1 from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id) then
      insert into public.client_inactive_events (athlete_id, group_id, event, source, by_profile) values (p_athlete_id, p_group_id, 'set_aside', 'coach', auth.uid());
    end if;
    insert into public.client_inactive (athlete_id, group_id, since, note, set_by)
    values (p_athlete_id, p_group_id, now(), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    on conflict (athlete_id, group_id) do update set since = now(), note = excluded.note, set_by = excluded.set_by;
  else
    if exists (select 1 from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id) then
      delete from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id;
      insert into public.client_inactive_events (athlete_id, group_id, event, source, by_profile) values (p_athlete_id, p_group_id, 'brought_back', 'coach', auth.uid());
    end if;
  end if;
end;
$function$;

create or replace function public.set_credit_expiry_hold(p_athlete_id uuid, p_group_id uuid, p_until timestamp with time zone, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_balance int;
  v_what text;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
    raise exception 'not authorized';
  end if;
  if p_until is not null and (p_until <= now() or p_until > now() + interval '5 years') then
    raise exception 'the hold must end between now and five years from now';
  end if;

  select balance into v_balance from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  if not found then
    raise exception 'this client has no session balance';
  end if;

  update public.session_credits set expiry_hold_until = p_until, updated_at = now() where athlete_id = p_athlete_id and group_id = p_group_id;

  v_what := case when p_until is null then 'Expiry hold removed' else 'Expiry held until ' || to_char(p_until, 'Mon FMDD, YYYY') end;
  insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note, created_by)
  values (p_athlete_id, p_group_id, 'adjusted', 0, v_balance, v_what || coalesce(': ' || nullif(btrim(p_note), ''), ''), auth.uid());
end;
$function$;

create or replace function public.reinstatable_expired_credits(p_athlete_id uuid, p_group_id uuid)
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and auth.uid() <> p_athlete_id
     and not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
    raise exception 'not authorized';
  end if;
  return greatest(0,
    coalesce((select sum(-l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'expired'), 0)
    - coalesce((select sum(r.amount - r.undone_amount) from public.session_credit_reinstatements r where r.athlete_id = p_athlete_id and r.group_id = p_group_id), 0)
  )::integer;
end;
$function$;

create or replace function public.reinstate_expired_credits(p_athlete_id uuid, p_group_id uuid, p_amount integer, p_note text default null::text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_available int;
  v_new_balance int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
    raise exception 'not authorized';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'choose at least one session';
  end if;
  -- Serialise two answers for the same client so the same expired sessions cannot be given back twice.
  perform 1 from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  v_available := public.reinstatable_expired_credits(p_athlete_id, p_group_id);
  if p_amount > v_available then
    raise exception 'only % expired sessions can be given back', v_available;
  end if;
  v_new_balance := public.apply_session_credit_change(
    p_athlete_id, p_group_id, p_amount, 'adjusted',
    'Reinstated expired sessions' || coalesce(': ' || nullif(btrim(p_note), ''), ''),
    null, auth.uid()
  );
  insert into public.session_credit_reinstatements (athlete_id, group_id, amount, created_by)
  values (p_athlete_id, p_group_id, p_amount, auth.uid());
  return v_new_balance;
end;
$function$;

create or replace function public.undo_expired_reinstatement(p_athlete_id uuid, p_group_id uuid, p_amount integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_outstanding int;
  v_balance int;
  v_since timestamptz;
  v_left int;
  v_row record;
  v_take int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
    raise exception 'not authorized';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'choose at least one session';
  end if;
  select balance into v_balance from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  if not found then
    raise exception 'this client has no session balance';
  end if;
  select coalesce(sum(amount - undone_amount), 0), max(greatest(created_at, coalesce(last_undone_at, created_at)))
    into v_outstanding, v_since
    from public.session_credit_reinstatements where athlete_id = p_athlete_id and group_id = p_group_id;
  if p_amount > v_outstanding then
    raise exception 'only % reinstated sessions can be taken back', v_outstanding;
  end if;
  if p_amount > v_balance then
    raise exception 'the client has already used some of those sessions';
  end if;
  -- Only while nothing has happened to the client's sessions since the give-back (or since the last take-back): a session used, bought, assigned,
  -- refunded or charged since then means this could take back other sessions than the ones that were given back.
  if exists (
    select 1 from public.session_credit_ledger l
    where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.amount <> 0 and l.created_at > v_since
  ) then
    raise exception 'the client''s sessions have changed since they were given back, so this can no longer be undone here; adjust the balance by hand instead';
  end if;

  -- Take the sessions back from the newest give-backs first.
  v_left := p_amount;
  for v_row in
    select id, amount - undone_amount as open_amount from public.session_credit_reinstatements
    where athlete_id = p_athlete_id and group_id = p_group_id and amount - undone_amount > 0
    order by created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_row.open_amount);
    update public.session_credit_reinstatements set undone_amount = undone_amount + v_take, last_undone_at = clock_timestamp() where id = v_row.id;
    v_left := v_left - v_take;
  end loop;
  return public.apply_session_credit_change(p_athlete_id, p_group_id, -p_amount, 'adjusted', 'Reinstatement undone', null, auth.uid());
end;
$function$;

-- 3. A row about a person is only filed in a group the person belongs to, in ten more places, and a progress photo must be stored in its owner's own folder ------------------------------------------
-- (The same rule the other client records already have, from 0340; the server and migrations are not affected.)
do $$
declare
  t text;
begin
  foreach t in array array['athlete_notes', 'client_ai_notes', 'client_progress_pins', 'session_pattern_checks', 'pro_shop_link_day_pins', 'coach_video_checkin_action_items', 'guardian_links', 'workout_logs', 'progress_photos', 'food_log_entries']
  loop
    if not exists (
      select 1 from pg_trigger tg where tg.tgrelid = ('public.' || t)::regclass and tg.tgfoid = 'public.enforce_athlete_in_group()'::regprocedure and not tg.tgisinternal
    ) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.enforce_athlete_in_group()', t || '_enforce_athlete_in_group', t);
    end if;
  end loop;
end $$;

drop policy if exists "progress_photos_write_own" on public.progress_photos;
create policy "progress_photos_write_own" on public.progress_photos for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()) and storage_path like (select auth.uid())::text || '/%');

-- 4. A record of changes to the rows that decide who can see and do what -------------------------------------------------------------------------------------------------------------------
-- The same append-only audit trail already kept for bookings, credits and billing. Only non-secret columns are recorded (never a PIN hash or an API key hash).
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('organizations',            'organizations_audit',            'owner_id,platform_fee_pct,restrict_cross_org_matching', 'update_only', 'id'),
      ('group_memberships',        'group_memberships_audit',        'role,private_from_org',                                 'update_only', 'group_id,profile_id'),
      ('organization_memberships', 'organization_memberships_audit', 'role,revenue_share_pct,stripe_connect_account_id',      'insert_too',  'organization_id,profile_id'),
      ('minor_consent',            'minor_consent_audit',            'verified,verified_by,method',                           'insert_too',  'athlete_id'),
      ('guardian_links',           'guardian_links_audit',           'revoked_at,expires_at',                                 'insert_too',  'id'),
      ('kiosk_pins',               'kiosk_pins_audit',               'set_by,set_at,locked_until',                            'insert_too',  'group_id,athlete_id'),
      ('coach_api_keys',           'coach_api_keys_audit',           'coach_id,created_at',                                   'insert_too',  'coach_id'),
      ('legal_acceptances',        'legal_acceptances_audit',        'document,version',                                      'insert_too',  'profile_id')
    ) as v(tbl, trg, cols, mode, keycols)
  loop
    if not exists (select 1 from pg_trigger tg where tg.tgname = spec.trg and tg.tgrelid = ('public.' || spec.tbl)::regclass) then
      execute format('create trigger %I after insert or update on public.%I for each row execute function public.audit_watch(%L, %L, %L)', spec.trg, spec.tbl, spec.cols, spec.mode, spec.keycols);
    end if;
  end loop;
end $$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 134 (0383)' as step, '0383 A text STOP is remembered for the phone number: nobody can opt in with it' as what, not ((to_regclass('public.sms_suppressed_numbers') is null)) as in_place
  union all
  select 'step 135 (0384)' as step, '0384 Privacy closures: shared lists changed only by their owner' as what, not ((to_regprocedure('public.is_group_private_from_org(uuid)') is null)) as in_place
) as result order by step;
