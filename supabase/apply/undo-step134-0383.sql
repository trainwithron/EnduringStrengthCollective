-- UNDO for step 134 (0383). Only if step 134 misbehaves. Puts back the earlier text functions and removes the list of stopped numbers (a STOP then only affects clients who had opted in with that number).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
create or replace function public.record_sms_stop(p_phone text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;

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
    -- Still on the record: a STOP from a number we hold no consent for.
    insert into public.sms_consent_events (athlete_id, phone_e164, event, source)
    values (null, p_phone, 'stop', 'sms_reply');
  end if;
  return v_count;
end;
$$;
create or replace function public.record_sms_start(p_phone text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;

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
$$;
create or replace function public.sms_consent_for_dispatch(p_athlete_id uuid, p_scope text)
returns table(phone_e164 text, allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
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
  if c.opted_out_at is not null then
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
$$;
create or replace function public.set_sms_consent(
  p_phone text,
  p_appointments boolean,
  p_announcements boolean,
  p_disclosure_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  select * into v_existing from public.athlete_sms_consent where athlete_id = v_uid;

  if found and v_existing.phone_e164 <> p_phone then
    v_phone_changed := true;
    insert into public.sms_consent_events (athlete_id, phone_e164, event, source, disclosure_version)
    values (v_uid, v_existing.phone_e164, 'phone_changed', 'settings', p_disclosure_version);
  end if;

  -- After a STOP reply the carrier blocks this number until it texts
  -- START; letting the toggles flip back on here would only look enabled.
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
$$;
drop table if exists public.sms_suppressed_numbers;
commit;
