-- PASTE: step 230 (a coach can confirm a client with no birthday on file is 18 or older; Ron vouched for his current clients with no birthday, so they are confirmed here too).
-- Paste all of it into the Supabase SQL editor and run. Last result: one row, all true, and ron_confirmed = the number of Ron's clients with no birthday (13 on Nov 24).
-- If the precheck stops it, nothing was changed: run "rollback;" and tell Spot.

begin;

-- Precheck: the four functions this changes are exactly the ones it was written from.
do $$
begin
  if not (md5(replace((select prosrc from pg_proc where oid = 'public.minor_may_write'::regproc), chr(13), '')) in ('4ce90722aeaf6b38d53f56a86f231d9f', '5bd52a5689ffa1152f5a2ca031bd92c8')) then raise exception 'step 230 precheck: minor_may_write is not the version this was written from. NOTHING was changed.'; end if;
  if not (md5(replace((select prosrc from pg_proc where oid = 'public.minor_subject_ok'::regproc), chr(13), '')) in ('d67ec0667c1284d0e24afd70c874a468', 'c675e8f6b75de9a51b2865f1e2afbfc0')) then raise exception 'step 230 precheck: minor_subject_ok is not the version this was written from. NOTHING was changed.'; end if;
  if not (md5(replace((select prosrc from pg_proc where oid = 'public.notice_display_name'::regproc), chr(13), '')) in ('2251b9649248307314e2d07596444258', 'ceeb19c1ac0183274f159393c198194e')) then raise exception 'step 230 precheck: notice_display_name is not the version this was written from. NOTHING was changed.'; end if;
  if not (md5(replace((select prosrc from pg_proc where oid = 'public.training_partner_intake_incomplete'::regproc), chr(13), '')) in ('23603214443916629981a3cee33125e6', '4f80d364203fa49f43a6e90fbc146d24')) then raise exception 'step 230 precheck: training_partner_intake_incomplete is not the version this was written from. NOTHING was changed.'; end if;
end $$;

-- Step 230 (Ron, Nov 24: "I can vouch for everyone that doesn't have a birthday submitted. They are over 18. Give them the full feature list ... give them the bars.").
-- A client with no date of birth on file has been treated like someone under 18 everywhere (names shortened, no macro comparison, the youth limits in the builder, no video calls,
-- writes held). A coach of theirs can now confirm they are 18 or older. The one rule, here and in the app (lib/youth-block.ts ageStatusOf): an adult is a client whose date of birth
-- says 18 or over, OR who has NO date of birth and a coach's confirmation. A date of birth that says under 18 always wins (the profile birthday too), so a real birthday overrides
-- the confirmation. Parent and guardian steps are not changed: they follow a real date of birth only. For any client nobody confirmed, an unknown age is still treated as a minor.
-- The confirmation is its own table (like guardian_coach_confirmations, 0444): a client never writes it, and it needs no intake row (most clients with no birthday have none).
-- Re-running is safe.

create table if not exists public.client_adult_confirmations (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now()
);
alter table public.client_adult_confirmations enable row level security;
revoke all on public.client_adult_confirmations from anon, authenticated;

-- The rule's database half: confirmed by a coach who still coaches EVERY live group the person is a member of, training or social (so a confirmation made from a second,
-- made-up coach account never counts in a real coach's group or feed, and it lapses when the coach who made it stops coaching them), no date of birth in client_intake, and no
-- profile birthday that says under 18.
-- Only the database's own functions call it.
create or replace function public.coach_confirmed_adult(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.client_adult_confirmations c
      where c.athlete_id = p_person and c.confirmed_by is not null
        and not exists (
          select 1
          from public.group_memberships m
          join public.groups g on g.id = m.group_id and g.archived_at is null
          where m.profile_id = p_person and m.role = 'athlete'
            and not exists (select 1 from public.group_memberships cc where cc.group_id = m.group_id and cc.profile_id = c.confirmed_by and cc.role = 'coach')
        )
    )
    and not exists (select 1 from public.client_intake ci where ci.athlete_id = p_person and ci.date_of_birth is not null)
    and not exists (
      select 1 from public.athlete_profile_details d
      where d.athlete_id = p_person and d.birthday is not null and d.birthday not in ('infinity'::date, '-infinity'::date)
        and current_date < public.age_threshold_date(d.birthday, 18)
    );
$$;
revoke execute on function public.coach_confirmed_adult(uuid) from public, anon, authenticated;
grant execute on function public.coach_confirmed_adult(uuid) to service_role;

-- Which of these clients count as adults on a coach's confirmation, for the app's screens. Answered only about the caller, a client the caller coaches, or for the server;
-- anyone else is simply not in the answer (it cannot be used to learn about other people).
create or replace function public.confirmed_adult_ids(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.athlete_id
  from public.client_adult_confirmations c
  where c.athlete_id = any (coalesce(p_ids, '{}'::uuid[]))
    and public.coach_confirmed_adult(c.athlete_id)
    and (
      coalesce(auth.role(), '') = 'service_role'
      or c.athlete_id = auth.uid()
      or exists (
        select 1 from public.group_memberships a
        where a.profile_id = c.athlete_id and a.role = 'athlete' and public.is_group_coach(a.group_id)
      )
    );
$$;
revoke execute on function public.confirmed_adult_ids(uuid[]) from public, anon;
grant execute on function public.confirmed_adult_ids(uuid[]) to authenticated, service_role;

-- Tick (or untick) "18 or older (no birthday on file)": only a coach of a live group where the client trains, never for themselves (a coach training in their own space
-- cannot vouch for their own age), and only while no birthday is on file.
create or replace function public.set_adult_confirmed(p_athlete uuid, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_athlete = auth.uid() or not exists (
    select 1 from public.group_memberships a
    join public.groups g on g.id = a.group_id
    where a.profile_id = p_athlete and a.role = 'athlete' and a.membership_type = 'training' and g.archived_at is null and public.is_group_coach(a.group_id)
  ) then
    raise exception 'not authorized';
  end if;
  if coalesce(p_confirmed, false) then
    if exists (select 1 from public.client_intake where athlete_id = p_athlete and date_of_birth is not null) then
      raise exception 'This client has a birthday on file, so their age comes from it.';
    end if;
    insert into public.client_adult_confirmations (athlete_id, confirmed_by) values (p_athlete, auth.uid())
    on conflict (athlete_id) do update set confirmed_by = auth.uid(), confirmed_at = now();
  else
    delete from public.client_adult_confirmations where athlete_id = p_athlete;
  end if;
end;
$$;
revoke execute on function public.set_adult_confirmed(uuid, boolean) from public, anon;
grant execute on function public.set_adult_confirmed(uuid, boolean) to authenticated, service_role;

-- The database's own adult checks follow the same rule (each is its live body with the confirmation added; nothing else changed).
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
    -- no birthday on file: an adult only on a coach's confirmation (step 230)
    return public.coach_confirmed_adult(p_user);
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
  -- no date of birth on file and a coach of theirs confirmed they are 18 or older (step 230)
  if public.coach_confirmed_adult(p_person) then
    return true;
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
    when ci.date_of_birth is null and public.coach_confirmed_adult(p.id) then btrim(p.full_name)
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
  )
  and not public.coach_confirmed_adult(p_athlete_id);
$$;

-- Ron's word (Nov 24, in chat): every current client of his with no birthday on file is over 18. Confirmed in his name. Anyone with a birthday on file is left out (their age comes
-- from it), and so is anyone whose profile birthday says under 18. Re-running adds nobody twice.
insert into public.client_adult_confirmations (athlete_id, confirmed_by)
select distinct a.profile_id, '136394ed-f108-4283-bcb7-310a1ac6cbc8'::uuid
from public.group_memberships c
join public.group_memberships a on a.group_id = c.group_id and a.role = 'athlete' and a.membership_type = 'training'
join public.groups g on g.id = a.group_id and g.archived_at is null
where c.profile_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8'::uuid and c.role = 'coach' and a.profile_id <> '136394ed-f108-4283-bcb7-310a1ac6cbc8'::uuid
  and not exists (select 1 from public.client_intake ci where ci.athlete_id = a.profile_id and ci.date_of_birth is not null)
  and not exists (select 1 from public.athlete_profile_details d where d.athlete_id = a.profile_id and d.birthday is not null and d.birthday > (current_date - interval '18 years')::date)
on conflict (athlete_id) do nothing;

commit;

-- Check: one row, all true, and ron_confirmed = 13.
select
  to_regclass('public.client_adult_confirmations') is not null as confirmations_table,
  (select relrowsecurity from pg_class where oid = 'public.client_adult_confirmations'::regclass) as row_security_on,
  not has_table_privilege('authenticated', 'public.client_adult_confirmations', 'select') and not has_table_privilege('authenticated', 'public.client_adult_confirmations', 'insert')
    and not has_table_privilege('authenticated', 'public.client_adult_confirmations', 'update') and not has_table_privilege('authenticated', 'public.client_adult_confirmations', 'delete')
    and not has_table_privilege('anon', 'public.client_adult_confirmations', 'select') as no_direct_access,
  not has_function_privilege('authenticated', 'public.coach_confirmed_adult(uuid)', 'execute') and not has_function_privilege('anon', 'public.coach_confirmed_adult(uuid)', 'execute') as rule_internal_only,
  has_function_privilege('authenticated', 'public.set_adult_confirmed(uuid, boolean)', 'execute') and not has_function_privilege('anon', 'public.set_adult_confirmed(uuid, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.confirmed_adult_ids(uuid[])', 'execute') and not has_function_privilege('anon', 'public.confirmed_adult_ids(uuid[])', 'execute') as coach_tools_signed_in_only,
  md5(replace((select prosrc from pg_proc where oid = 'public.minor_may_write'::regproc), chr(13), '')) = '5bd52a5689ffa1152f5a2ca031bd92c8'
    and md5(replace((select prosrc from pg_proc where oid = 'public.minor_subject_ok'::regproc), chr(13), '')) = 'c675e8f6b75de9a51b2865f1e2afbfc0'
    and md5(replace((select prosrc from pg_proc where oid = 'public.notice_display_name'::regproc), chr(13), '')) = 'ceeb19c1ac0183274f159393c198194e'
    and md5(replace((select prosrc from pg_proc where oid = 'public.training_partner_intake_incomplete'::regproc), chr(13), '')) = '4f80d364203fa49f43a6e90fbc146d24' as age_checks_as_written,
  not exists (select 1 from public.client_adult_confirmations c join public.client_intake ci on ci.athlete_id = c.athlete_id where ci.date_of_birth is not null) as nobody_confirmed_has_a_birthday,
  (select count(*) from public.client_adult_confirmations where confirmed_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8'::uuid) as ron_confirmed;
