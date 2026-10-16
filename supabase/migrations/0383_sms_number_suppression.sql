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
