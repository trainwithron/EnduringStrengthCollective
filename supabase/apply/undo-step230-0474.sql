-- UNDO: step 230. Only if it must be taken back: removes every coach confirmation of 18 or older (clients with no birthday on file are treated as under 18 again) and puts the
-- four age checks back exactly as they were. Last result: one row, all true.

begin;

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

create or replace function public.minor_subject_ok(p_person uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_coach boolean;
  v_has_athlete boolean;
  v_intake_dob date;
  v_profile_birthday date;
  v_youngest date;
  v_today date := current_date;
begin
  -- a video that is not of one person
  if p_person is null then
    return true;
  end if;
  -- the person themselves: their own upload is ruled by minor_may_write (the policy beside this one)
  if p_person = auth.uid() then
    return true;
  end if;
  -- only someone who coaches a group the person is in (or the server) is answered; anyone else gets false and learns nothing
  if coalesce(auth.role(), '') <> 'service_role' and not exists (
    select 1
    from public.group_memberships c
    join public.group_memberships a on a.group_id = c.group_id
    where c.profile_id = auth.uid() and c.role = 'coach' and a.profile_id = p_person
  ) then
    return false;
  end if;

  select coalesce(bool_or(role = 'coach'), false), coalesce(bool_or(role = 'athlete'), false)
    into v_has_coach, v_has_athlete
  from public.group_memberships
  where profile_id = p_person;
  -- a coach, or someone who is nobody's client, is not a minor client
  if v_has_coach or not v_has_athlete then
    return true;
  end if;

  select date_of_birth into v_intake_dob from public.client_intake where athlete_id = p_person limit 1;
  select birthday into v_profile_birthday from public.athlete_profile_details where athlete_id = p_person limit 1;
  if v_intake_dob in ('infinity'::date, '-infinity'::date) then v_intake_dob := null; end if;
  if v_profile_birthday in ('infinity'::date, '-infinity'::date) then v_profile_birthday := null; end if;
  -- the younger of the two dates on file, when there are two
  v_youngest := greatest(v_intake_dob, v_profile_birthday);

  -- an adult by a date on file
  if v_youngest is not null and v_today >= public.age_threshold_date(v_youngest, 18) then
    return true;
  end if;
  -- under 13: never
  if v_youngest is not null and v_today < public.age_threshold_date(v_youngest, 13) then
    return false;
  end if;
  -- 13 to 17, or no date of birth on file: only with a parent's OK on file
  return exists (select 1 from public.guardian_consents where athlete_id = p_person and status = 'signed')
      or exists (select 1 from public.guardian_coach_confirmations where athlete_id = p_person);
end;
$$;

create or replace function public.notice_display_name(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.full_name is null or btrim(p.full_name) = '' then null
    when exists (select 1 from public.group_memberships c where c.profile_id = p.id and c.role = 'coach') then btrim(p.full_name)
    when exists (select 1 from public.organization_memberships o where o.profile_id = p.id and o.role in ('owner', 'admin'))
         and not exists (select 1 from public.group_memberships a where a.profile_id = p.id and a.role = 'athlete') then btrim(p.full_name)
    when ci.date_of_birth is not null and ci.date_of_birth + interval '18 years' <= current_date then btrim(p.full_name)
    when cardinality(regexp_split_to_array(btrim(p.full_name), '\s+')) = 1 then btrim(p.full_name)
    else (regexp_split_to_array(btrim(p.full_name), '\s+'))[1] || ' ' || upper(left((regexp_split_to_array(btrim(p.full_name), '\s+'))[cardinality(regexp_split_to_array(btrim(p.full_name), '\s+'))], 1)) || '.'
  end
  from public.profiles p
  left join public.client_intake ci on ci.athlete_id = p.id
  where p.id = p_profile
$$;

create or replace function public.training_partner_intake_incomplete(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.client_intake
    where athlete_id = p_athlete_id and date_of_birth is not null
  );
$$;

drop function if exists public.set_adult_confirmed(uuid, boolean);
drop function if exists public.confirmed_adult_ids(uuid[]);
drop function if exists public.coach_confirmed_adult(uuid);
drop table if exists public.client_adult_confirmations;

commit;

-- Check: one row, all true.
select
  to_regclass('public.client_adult_confirmations') is null as confirmations_gone,
  to_regprocedure('public.coach_confirmed_adult(uuid)') is null and to_regprocedure('public.confirmed_adult_ids(uuid[])') is null and to_regprocedure('public.set_adult_confirmed(uuid, boolean)') is null as functions_gone,
  md5(replace((select prosrc from pg_proc where oid = 'public.minor_may_write'::regproc), chr(13), '')) = '4ce90722aeaf6b38d53f56a86f231d9f'
    and md5(replace((select prosrc from pg_proc where oid = 'public.minor_subject_ok'::regproc), chr(13), '')) = 'd67ec0667c1284d0e24afd70c874a468'
    and md5(replace((select prosrc from pg_proc where oid = 'public.notice_display_name'::regproc), chr(13), '')) = '2251b9649248307314e2d07596444258'
    and md5(replace((select prosrc from pg_proc where oid = 'public.training_partner_intake_incomplete'::regproc), chr(13), '')) = '23603214443916629981a3cee33125e6' as age_checks_as_before;
