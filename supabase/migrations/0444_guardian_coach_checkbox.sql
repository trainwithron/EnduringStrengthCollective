-- A coach's checkbox for a teen client (Ron, Nov 3: parent consent by email is "annoying to me and I talk to parents before they train with me"; he chose "check box").
-- A client aged 13 to 17 may start when a parent or guardian signed the emailed permission (migration 0402), OR when a coach of theirs ticks "I've talked with their parent or
-- guardian". The tick is recorded with who and when, and can be taken back. Under 13 is unchanged: never let in, whatever is ticked.
-- guardian_consent_state answers 'signed' for a tick too (with coach_confirmed), so the sign-in gate (lib/dob-gate.ts) and every screen that reads it agree; minor_may_write (the
-- database's own write guard) counts it as well.

create table if not exists public.guardian_coach_confirmations (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now()
);
alter table public.guardian_coach_confirmations enable row level security;
revoke all on public.guardian_coach_confirmations from anon, authenticated;

-- Tick (or untick) it: only a coach of a live group where the client trains.
create or replace function public.set_guardian_confirmed(p_athlete uuid, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_memberships a
    join public.groups g on g.id = a.group_id
    where a.profile_id = p_athlete and a.role = 'athlete' and a.membership_type = 'training' and g.archived_at is null and public.is_group_coach(a.group_id)
  ) then
    raise exception 'not authorized';
  end if;
  if coalesce(p_confirmed, false) then
    insert into public.guardian_coach_confirmations (athlete_id, confirmed_by) values (p_athlete, auth.uid())
    on conflict (athlete_id) do update set confirmed_by = auth.uid(), confirmed_at = now();
  else
    delete from public.guardian_coach_confirmations where athlete_id = p_athlete;
  end if;
end;
$$;
revoke execute on function public.set_guardian_confirmed(uuid, boolean) from public, anon;
grant execute on function public.set_guardian_confirmed(uuid, boolean) to authenticated, service_role;

create or replace function public.guardian_consent_state(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.guardian_consents%rowtype;
  c public.guardian_coach_confirmations%rowtype;
begin
  if not (
    auth.role() = 'service_role'
    or (auth.uid() is not null and (
      auth.uid() = p_athlete
      or exists (
        select 1 from public.group_memberships a
        join public.groups g on g.id = a.group_id
        where a.profile_id = p_athlete and a.role = 'athlete' and a.membership_type = 'training' and g.archived_at is null and public.is_group_coach(a.group_id)
      )
    ))
  ) then
    return null;
  end if;
  -- a signature that stands wins; then a coach's tick (step 199); otherwise the latest request that was not replaced: waiting, run out of time ('expired'), or taken back
  select * into r from public.guardian_consents where athlete_id = p_athlete and status = 'signed' limit 1;
  if not found then
    select * into c from public.guardian_coach_confirmations where athlete_id = p_athlete;
    if found then
      return jsonb_build_object(
        'state', 'signed',
        'coach_confirmed', true,
        'confirmed_at', c.confirmed_at,
        'confirmed_by_name', (select p.full_name from public.profiles p where p.id = c.confirmed_by)
      );
    end if;
    select * into r from public.guardian_consents where athlete_id = p_athlete and status in ('pending', 'withdrawn') order by created_at desc limit 1;
  end if;
  if not found then
    return jsonb_build_object('state', 'none');
  end if;
  return jsonb_build_object(
    'state', case when r.status = 'signed' then 'signed' when r.status = 'withdrawn' then 'withdrawn' when r.expires_at > now() then 'pending' else 'expired' end,
    'guardian_email', r.guardian_email,
    'guardian_name', r.guardian_name,
    'relationship', r.relationship,
    'requested_at', r.created_at,
    'expires_at', r.expires_at,
    'signed_at', r.signed_at,
    'withdrawn_at', r.withdrawn_at
  );
end;
$$;

create or replace function public.minor_may_write(p_user uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_coach boolean;
  v_has_athlete boolean;
  v_staff boolean;
  v_intake_dob date;
  v_profile_birthday date;
  v_youngest date;
  v_today date := current_date;
begin
  if p_user is null then
    return false;
  end if;
  -- It answers only about the caller (or for the server): asking about someone else gets the same 'false' as asking about nobody, so it cannot be used to learn who is a minor or who has a guardian on file.
  if p_user is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;

  select coalesce(bool_or(role = 'coach'), false), coalesce(bool_or(role = 'athlete'), false)
    into v_has_coach, v_has_athlete
  from public.group_memberships
  where profile_id = p_user;

  -- someone who is not a client, or who also coaches, is never asked
  if v_has_coach or not v_has_athlete then
    return true;
  end if;

  select exists (select 1 from public.organization_memberships where profile_id = p_user)
      or exists (select 1 from public.org_front_desk where profile_id = p_user)
    into v_staff;

  select date_of_birth into v_intake_dob from public.client_intake where athlete_id = p_user limit 1;
  select birthday into v_profile_birthday from public.athlete_profile_details where athlete_id = p_user limit 1;
  -- an impossible date counts as no date (and never makes the function raise)
  if v_intake_dob in ('infinity'::date, '-infinity'::date) then v_intake_dob := null; end if;
  if v_profile_birthday in ('infinity'::date, '-infinity'::date) then v_profile_birthday := null; end if;
  v_youngest := greatest(v_intake_dob, v_profile_birthday);

  -- staff pass unless a date on file shows they are under 18 (staff status never switches off the age rules for a known minor)
  if v_staff and (v_youngest is null or v_today >= public.age_threshold_date(v_youngest, 18)) then
    return true;
  end if;

  -- a client: the date of birth in client_intake is the one place the age rules read
  if v_intake_dob is null then
    return false;
  end if;
  if v_today < public.age_threshold_date(v_intake_dob, 13) then
    return false;
  end if;
  if v_today < public.age_threshold_date(v_intake_dob, 18) then
    -- a parent or guardian's signature, or the coach's word that they talked with the parent (step 199)
    return exists (select 1 from public.guardian_consents where athlete_id = p_user and status = 'signed')
        or exists (select 1 from public.guardian_coach_confirmations where athlete_id = p_user);
  end if;
  return true;
end;
$$;
