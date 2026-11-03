-- PASTE: steps 198 + 199 together (Kiosk modes and key cards, then the coach's parent checkbox). Paste all of this into the Supabase SQL editor and Run.
-- The last result is 13 rows; every one should say true. If you already ran step 198, running it again is safe: nothing is duplicated or lost.

-- Step 198 (Ron, Nov 2: the Kiosk for "a specific group" or "your front desk check-in type of deal", and the gym's key cards with a scanner, brought over from a Mindbody export).
-- Adds: a Kiosk mode per group (group list or the whole organization's front desk), one key card number per client per organization, a scan check-in that follows the
-- same rules and wrong-code limit as the PIN check-in, and the list the Kiosk settings page shows in front-desk mode. Nobody signed in writes a card directly; the functions
-- check who is asking. Nothing existing is changed or removed (every group starts in 'group' mode, as today). Re-running is safe.

-- Kiosk modes and key cards (Ron, Nov 2: "are you using this for a specific group, or is this gonna be like your front desk check-in type of deal?" ... "every member at
-- the gym already has a key card ... a CSV export from MindBody for all of them and then a CSV upload into this").
--
-- 1. groups.kiosk_mode: what the Kiosk settings page opens for this group. 'group' is that group's own list (a class or a team); 'front_desk' is the whole organization's
--    front desk (/front-desk), for a gym's door, even with nobody at the desk. Changed only through set_kiosk_mode (a coach of the group).
-- 2. checkin_cards: one key card per client per organization (the number the card's barcode holds). A card number belongs to one client in an organization. Written only
--    through set_checkin_card; read by the client themselves (their check-in code in the app), the organization's owner and admins, and a coach of one of the client's groups.
-- 3. card_check_in: a scanned card checks its client in, with the same who-may-check-in rules and the same wrong-code limit as front_desk_check_in (migration 0400).
-- 4. kiosk_settings_roster: every client the caller may manage on the Kiosk settings page in front-desk mode, with whether they have a PIN and a card.

alter table public.groups add column if not exists kiosk_mode text not null default 'group';
alter table public.groups drop constraint if exists groups_kiosk_mode_check;
alter table public.groups add constraint groups_kiosk_mode_check check (kiosk_mode in ('group', 'front_desk'));

create or replace function public.set_kiosk_mode(p_group uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_coach(p_group) then
    raise exception 'not authorized';
  end if;
  if p_mode is null or p_mode not in ('group', 'front_desk') then
    raise exception 'a kiosk mode is group or front_desk';
  end if;
  update public.groups set kiosk_mode = p_mode where id = p_group;
end;
$$;
revoke execute on function public.set_kiosk_mode(uuid, text) from public, anon;
grant execute on function public.set_kiosk_mode(uuid, text) to authenticated, service_role;

create table if not exists public.checkin_cards (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  card_code text not null check (char_length(card_code) between 3 and 64 and card_code ~ '^[[:graph:]]+$'),
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (organization_id, athlete_id),
  unique (organization_id, card_code)
);
alter table public.checkin_cards enable row level security;
revoke all on public.checkin_cards from anon, authenticated;
grant select on public.checkin_cards to authenticated;

drop policy if exists "checkin_cards_read" on public.checkin_cards;
create policy "checkin_cards_read" on public.checkin_cards for select to authenticated
  using (
    athlete_id = (select auth.uid())
    or public.is_org_active_owner_or_admin(organization_id)
    or exists (
      select 1 from public.group_memberships m
      join public.groups g on g.id = m.group_id
      where m.profile_id = checkin_cards.athlete_id
        and m.role = 'athlete'
        and g.organization_id = checkin_cards.organization_id
        and public.is_group_coach(m.group_id)
    )
  );

-- May the caller manage this client's card in this organization: the owner or an admin, or a coach of one of the client's groups there. The client must train in the organization.
create or replace function public._may_manage_checkin_card(p_org uuid, p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.group_memberships m
      join public.groups g on g.id = m.group_id
      where m.profile_id = p_athlete and m.role = 'athlete' and g.organization_id = p_org and g.archived_at is null
        and (public.is_org_active_owner_or_admin(p_org) or public.is_group_coach(m.group_id))
    )
$$;
revoke execute on function public._may_manage_checkin_card(uuid, uuid) from public, anon, authenticated;

-- Link (or, with an empty code, remove) a client's card. Answers 'ok', 'removed', or 'taken' (the number is another client's in this organization; nothing is changed).
create or replace function public.set_checkin_card(p_org uuid, p_athlete uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
begin
  if not public._may_manage_checkin_card(p_org, p_athlete) then
    raise exception 'not authorized';
  end if;
  if v_code is null then
    delete from public.checkin_cards where organization_id = p_org and athlete_id = p_athlete;
    return 'removed';
  end if;
  if char_length(v_code) < 3 or char_length(v_code) > 64 or v_code !~ '^[[:graph:]]+$' then
    raise exception 'a card number is 3 to 64 letters or digits, with no spaces';
  end if;
  if exists (select 1 from public.checkin_cards c where c.organization_id = p_org and c.card_code = v_code and c.athlete_id <> p_athlete) then
    return 'taken';
  end if;
  insert into public.checkin_cards (organization_id, athlete_id, card_code, set_by)
  values (p_org, p_athlete, v_code, auth.uid())
  on conflict (organization_id, athlete_id) do update
    set card_code = excluded.card_code, set_by = auth.uid(), set_at = now();
  return 'ok';
end;
$$;
revoke execute on function public.set_checkin_card(uuid, uuid, text) from public, anon;
grant execute on function public.set_checkin_card(uuid, uuid, text) to authenticated, service_role;

-- A scanned card checks its client in. p_group (the group kiosk) keeps it to that group; without it (the front desk) any group of the organization the caller may check in to.
-- Answers ok (with the shown name), unknown (no such card here), not_here (the card's client is not someone this kiosk checks in), or throttled.
create or replace function public.card_check_in(p_org uuid, p_code text, p_group uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text := public._front_desk_scope(p_org);
  v_me uuid := auth.uid();
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_athlete uuid;
  v_group uuid;
  v_name text;
  v_at timestamptz;
begin
  if v_scope is null then
    raise exception 'not authorized';
  end if;
  if p_group is not null then
    if not exists (select 1 from public.groups g where g.id = p_group and g.organization_id = p_org and g.archived_at is null) then
      raise exception 'not authorized';
    end if;
    if v_scope <> 'all' and not public.is_group_coach(p_group) then
      raise exception 'not authorized';
    end if;
  end if;
  -- the same limit as a wrong PIN: no more than 10 misses from one signed-in person in 15 minutes
  if (select count(*) from public.front_desk_pin_misses x where x.caller = v_me and x.missed_at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('result', 'throttled');
  end if;
  select c.athlete_id into v_athlete from public.checkin_cards c where c.organization_id = p_org and c.card_code = v_code;
  if v_athlete is null then
    insert into public.front_desk_pin_misses (caller) values (v_me);
    delete from public.front_desk_pin_misses x where x.caller = v_me and x.missed_at < now() - interval '1 day';
    return jsonb_build_object('result', 'unknown');
  end if;
  select m.group_id, public._front_desk_display_name(p.full_name, ci.date_of_birth)
    into v_group, v_name
  from public.group_memberships m
  join public.groups g on g.id = m.group_id
  join public.profiles p on p.id = m.profile_id
  left join public.client_intake ci on ci.athlete_id = m.profile_id
  where m.profile_id = v_athlete
    and m.role = 'athlete'
    and m.membership_type = 'training'
    and not m.private_from_org
    and g.organization_id = p_org
    and g.archived_at is null
    and (p_group is null or m.group_id = p_group)
    and (v_scope = 'all' or public.is_group_coach(m.group_id))
  order by m.joined_at nulls last, m.group_id
  limit 1;
  if v_group is null then
    return jsonb_build_object('result', 'not_here');
  end if;
  insert into public.kiosk_checkins (group_id, athlete_id) values (v_group, v_athlete) returning checked_in_at into v_at;
  return jsonb_build_object('result', 'ok', 'checked_in_at', v_at, 'name', v_name);
end;
$$;
revoke execute on function public.card_check_in(uuid, text, uuid) from public, anon;
grant execute on function public.card_check_in(uuid, text, uuid) to authenticated, service_role;

-- The front-desk Kiosk settings list: every training client of the organization the caller coaches (all of them for the owner or an admin), one row per client and group,
-- with whether a PIN is set for that group and whether the client has a card. Not for front-desk-only staff (they check people in; they do not set codes).
create or replace function public.kiosk_settings_roster(p_org uuid)
returns table (athlete_id uuid, group_id uuid, group_name text, full_name text, has_pin boolean, has_card boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_all boolean := public.is_org_active_owner_or_admin(p_org);
begin
  if auth.uid() is null or not (
    v_all or exists (
      select 1 from public.organization_memberships om
      where om.organization_id = p_org and om.profile_id = auth.uid() and om.fired_at is null and om.access_ended_at is null
    )
  ) then
    raise exception 'not authorized';
  end if;
  return query
    select m.profile_id, m.group_id, g.name, coalesce(nullif(trim(p.full_name), ''), 'Client'),
           exists (select 1 from public.kiosk_pins kp where kp.group_id = m.group_id and kp.athlete_id = m.profile_id),
           exists (select 1 from public.checkin_cards c where c.organization_id = p_org and c.athlete_id = m.profile_id)
    from public.group_memberships m
    join public.groups g on g.id = m.group_id
    join public.profiles p on p.id = m.profile_id
    where g.organization_id = p_org
      and g.archived_at is null
      and m.role = 'athlete'
      and m.membership_type = 'training'
      and not m.private_from_org
      and (v_all or public.is_group_coach(m.group_id))
    order by 4, 3
    limit 5000;
end;
$$;
revoke execute on function public.kiosk_settings_roster(uuid) from public, anon;
grant execute on function public.kiosk_settings_roster(uuid) to authenticated, service_role;

-- Step 199 (Ron, Nov 3: parent consent by email is "annoying to me and I talk to parents before they train with me"; he chose "check box").
-- A coach ticks "I've talked with their parent or guardian" on a teen client's profile, and the client can start right away, the same as an emailed signature. Recorded with
-- who and when; unticking stops them again. Under 13 is unchanged (never let in). Nothing existing is removed: signed permissions still count. Re-running is safe.

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

-- Checks (read-only)
select 'kiosk mode column' as check, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'kiosk_mode') as ok
union all select 'cards table exists', to_regclass('public.checkin_cards') is not null
union all select 'row security on', (select relrowsecurity from pg_class where oid = 'public.checkin_cards'::regclass)
union all select 'signed-in people cannot write cards', not has_table_privilege('authenticated', 'public.checkin_cards', 'insert') and not has_table_privilege('authenticated', 'public.checkin_cards', 'update') and not has_table_privilege('authenticated', 'public.checkin_cards', 'delete')
union all select 'visitors cannot read cards', not has_table_privilege('anon', 'public.checkin_cards', 'select')
union all select 'card read rule in place', exists (select 1 from pg_policies where tablename = 'checkin_cards' and policyname = 'checkin_cards_read')
union all select 'scan check-in ready', has_function_privilege('authenticated', 'public.card_check_in(uuid, text, uuid)', 'execute') and not has_function_privilege('anon', 'public.card_check_in(uuid, text, uuid)', 'execute')
union all select 'card link ready', has_function_privilege('authenticated', 'public.set_checkin_card(uuid, uuid, text)', 'execute') and not has_function_privilege('anon', 'public.set_checkin_card(uuid, uuid, text)', 'execute')
union all select 'helper not callable directly', not has_function_privilege('authenticated', 'public._may_manage_checkin_card(uuid, uuid)', 'execute')
union all select 'parent checkbox table exists', to_regclass('public.guardian_coach_confirmations') is not null
union all select 'checkbox table is private', not has_table_privilege('authenticated', 'public.guardian_coach_confirmations', 'select') and not has_table_privilege('anon', 'public.guardian_coach_confirmations', 'select')
union all select 'checkbox ready for coaches', has_function_privilege('authenticated', 'public.set_guardian_confirmed(uuid, boolean)', 'execute') and not has_function_privilege('anon', 'public.set_guardian_confirmed(uuid, boolean)', 'execute')
union all select 'gate counts the checkbox', pg_get_functiondef('public.minor_may_write(uuid)'::regprocedure) like '%guardian_coach_confirmations%' and pg_get_functiondef('public.guardian_consent_state(uuid)'::regprocedure) like '%coach_confirmed%';
