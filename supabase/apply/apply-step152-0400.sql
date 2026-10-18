-- STEP 152: 0400 Release T1: the front desk (a person an owner or admin invites to check clients in on an organization-wide screen, and nothing else)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release T1 code is live. Adds one small table of front-desk people, five functions (find a client by name, check a client in, list my organizations, remove a front-desk person, and the shared check-in code test), lets an invitation name the front-desk role, and makes the existing check-in code test (verify_kiosk_pin) call the shared one with the same answers and the same coach-only guard.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.org_front_desk') is null)) then
    raise exception 'Step 152 (0400) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0400_front_desk.sql
-- ====================================================================================================

-- Release T1: the front desk. A person an organization's owner or admin has invited to work the front desk can check clients in on an organization-wide screen, and can do nothing else.
--
-- The front desk is deliberately NOT a new organization role: it is its own small table, so the person is not an organization member, holds no group seat, and every rule in the app that reads "is a member of this
-- organization" or "coaches this group" stays exactly as it was. They reach clients only through the functions below, which return a name, whether a check-in code is set, and nothing else (no health answers, programs,
-- notes, balances, reports or messages). A coach, an admin or the owner of the organization may use the same functions (a role above the front desk includes it).
--
-- Joining needs the person's own OK, like every other organization invitation (Release BD): there is no function that adds someone. The invitation is the existing one (organization_invites) with the role 'front_desk';
-- accepting it makes the row here. The owner or an admin can remove a front-desk person, and the person can leave.

create table if not exists public.org_front_desk (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);
create index if not exists org_front_desk_profile_idx on public.org_front_desk (profile_id);
alter table public.org_front_desk enable row level security;
revoke all on public.org_front_desk from anon, authenticated;
grant select on public.org_front_desk to authenticated;

-- Is the signed-in person an owner or admin of this organization whose access has not ended (the plain is_org_owner_or_admin ignores a let-go or ended membership, so it is not used for the front desk).
create or replace function public.is_org_active_owner_or_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships om
    where om.organization_id = target_org_id and om.profile_id = (select auth.uid()) and om.role in ('owner', 'admin') and om.fired_at is null and om.access_ended_at is null
  )
$$;
revoke execute on function public.is_org_active_owner_or_admin(uuid) from public, anon;
grant execute on function public.is_org_active_owner_or_admin(uuid) to authenticated, service_role;

-- A person sees their own row; an owner or admin (with access) sees the organization's. Nobody writes directly: the server (service role) adds, and the functions below remove.
drop policy if exists "org_front_desk_select" on public.org_front_desk;
create policy "org_front_desk_select" on public.org_front_desk for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_org_active_owner_or_admin(organization_id));

-- Wrong check-in codes typed by one signed-in person, to stop one person from locking many clients out (each client's own lock is unchanged). Server-side only.
create table if not exists public.front_desk_pin_misses (
  caller uuid not null references public.profiles(id) on delete cascade,
  missed_at timestamptz not null default now()
);
create index if not exists front_desk_pin_misses_caller_idx on public.front_desk_pin_misses (caller, missed_at);
alter table public.front_desk_pin_misses enable row level security;
revoke all on public.front_desk_pin_misses from anon, authenticated;

-- Internal. How far the signed-in person may work this organization's front desk: 'all' for a front-desk person of it or its owner or an admin (whose access has not ended), 'coach' for an ordinary coach of it
-- (only the clients of groups they coach themselves), null for anyone else.
create or replace function public._front_desk_scope(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from public.org_front_desk f where f.organization_id = p_org and f.profile_id = auth.uid()) then 'all'
    when public.is_org_active_owner_or_admin(p_org) then 'all'
    when exists (
      select 1 from public.organization_memberships om
      where om.organization_id = p_org and om.profile_id = auth.uid() and om.fired_at is null and om.access_ended_at is null
    ) then 'coach'
    else null
  end
$$;
revoke execute on function public._front_desk_scope(uuid) from public, anon, authenticated;

-- Internal. The name shown on the shared check-in tablet: the full name for someone whose date of birth says 18 or over, otherwise (under 18, or no date of birth on file) first name and last initial, "Sam R."
-- (the same rule as the shared boards, lib/minor-names.ts).
create or replace function public._front_desk_display_name(p_name text, p_dob date)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(p_name, '')), '') is null then 'An athlete'
    when p_dob is not null and p_dob + interval '18 years' <= current_date then trim(p_name)
    when cardinality(regexp_split_to_array(trim(p_name), '\s+')) = 1 then trim(p_name)
    else (regexp_split_to_array(trim(p_name), '\s+'))[1] || ' ' || upper(left((regexp_split_to_array(trim(p_name), '\s+'))[cardinality(regexp_split_to_array(trim(p_name), '\s+'))], 1)) || '.'
  end
$$;
revoke execute on function public._front_desk_display_name(text, date) from public, anon, authenticated;

-- The organizations the signed-in person can work the front desk of, with their names (a front-desk person cannot read the organizations table).
create or replace function public.front_desk_orgs()
returns table (organization_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name
  from public.organizations o
  where auth.uid() is not null
    and (
      exists (select 1 from public.org_front_desk f where f.organization_id = o.id and f.profile_id = auth.uid())
      or exists (
        select 1 from public.organization_memberships om
        where om.organization_id = o.id and om.profile_id = auth.uid() and om.fired_at is null and om.access_ended_at is null
      )
    )
  order by o.name
$$;
revoke execute on function public.front_desk_orgs() from public, anon;
grant execute on function public.front_desk_orgs() to authenticated, service_role;

-- Find a client by name for the check-in screen: at least two letters, at most 25 answers, only clients who train in a live group of this organization and have not made their records private from it. A front-desk
-- person, the owner and an admin search the whole organization; an ordinary coach only the clients of groups they coach. The answer is a name (shortened for anyone under 18 or of unknown age, and the search
-- matches that shortened name, so a child's full name cannot be found by guessing), the group to check in to, and whether a check-in code has been set.
create or replace function public.front_desk_find(p_org uuid, p_query text)
returns table (athlete_id uuid, group_id uuid, display_name text, has_pin boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := trim(coalesce(p_query, ''));
  v_scope text := public._front_desk_scope(p_org);
begin
  if v_scope is null then
    raise exception 'not authorized';
  end if;
  if length(q) < 2 then
    return;
  end if;
  return query
    select s.profile_id, s.group_id, s.shown,
           exists (select 1 from public.kiosk_pins kp where kp.group_id = s.group_id and kp.athlete_id = s.profile_id)
    from (
      select m.profile_id, m.group_id, public._front_desk_display_name(p.full_name, ci.date_of_birth) as shown
      from public.group_memberships m
      join public.groups g on g.id = m.group_id
      join public.profiles p on p.id = m.profile_id
      left join public.client_intake ci on ci.athlete_id = m.profile_id
      where g.organization_id = p_org
        and g.archived_at is null
        and m.role = 'athlete'
        and m.membership_type = 'training'
        and not m.private_from_org
        and (v_scope = 'all' or public.is_group_coach(m.group_id))
    ) s
    where s.shown ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    order by s.shown, s.group_id
    limit 25;
end;
$$;
revoke execute on function public.front_desk_find(uuid, text) from public, anon;
grant execute on function public.front_desk_find(uuid, text) to authenticated, service_role;

-- The check-in code test, moved out of verify_kiosk_pin unchanged so the coach's kiosk and the front desk share one rule (five wrong tries lock the code for 15 minutes, then an hour, then a day).
create or replace function public._check_kiosk_pin(p_group_id uuid, p_athlete_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.kiosk_pins%rowtype;
  v_lock_count int;
begin
  select * into v_row from public.kiosk_pins
  where group_id = p_group_id and athlete_id = p_athlete_id
  for update;
  if not found then
    return 'no_pin';
  end if;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return 'locked';
  end if;

  if p_pin is not null and v_row.pin_hash = extensions.crypt(p_pin, v_row.pin_hash) then
    update public.kiosk_pins
      set failed_attempts = 0, lock_count = 0, locked_until = null
      where group_id = p_group_id and athlete_id = p_athlete_id;
    return 'ok';
  end if;

  if v_row.failed_attempts + 1 >= 5 then
    v_lock_count := v_row.lock_count + 1;
    update public.kiosk_pins
      set failed_attempts = 0,
          lock_count = v_lock_count,
          locked_until = now() + case v_lock_count when 1 then interval '15 minutes' when 2 then interval '1 hour' else interval '24 hours' end
      where group_id = p_group_id and athlete_id = p_athlete_id;
    return 'locked';
  end if;

  update public.kiosk_pins set failed_attempts = v_row.failed_attempts + 1
    where group_id = p_group_id and athlete_id = p_athlete_id;
  return 'wrong';
end;
$$;
revoke execute on function public._check_kiosk_pin(uuid, uuid, text) from public, anon, authenticated;

-- Same answer and same guard as before: only a coach of the group may ask.
create or replace function public.verify_kiosk_pin(p_group_id uuid, p_athlete_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to check kiosk PINs';
  end if;
  return public._check_kiosk_pin(p_group_id, p_athlete_id, p_pin);
end;
$$;
grant execute on function public.verify_kiosk_pin(uuid, uuid, text) to authenticated;

-- Check a client in from the organization's front-desk screen. Returns {"result": "ok", "checked_in_at": ...} or {"result": "wrong" | "locked" | "no_pin"} (an answer, not an error, so the wrong-try count is kept).
create or replace function public.front_desk_check_in(p_group uuid, p_athlete uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_scope text;
  v_verdict text;
  v_at timestamptz;
  v_me uuid := auth.uid();
begin
  select g.organization_id into v_org from public.groups g where g.id = p_group and g.archived_at is null;
  v_scope := case when v_org is null then null else public._front_desk_scope(v_org) end;
  if v_scope is null then
    raise exception 'not authorized';
  end if;
  -- an ordinary coach checks in only the clients of groups they coach themselves
  if v_scope <> 'all' and not public.is_group_coach(p_group) then
    raise exception 'not authorized';
  end if;
  if not exists (
    select 1 from public.group_memberships m
    where m.group_id = p_group and m.profile_id = p_athlete and m.role = 'athlete' and m.membership_type = 'training' and not m.private_from_org
  ) then
    raise exception 'not authorized';
  end if;
  -- No more than 10 wrong codes from one signed-in person in 15 minutes, across all clients: then a plain "wait" (the code is not even tested). A client's own lock (five wrong tries) is unchanged.
  if (select count(*) from public.front_desk_pin_misses x where x.caller = v_me and x.missed_at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('result', 'throttled');
  end if;
  v_verdict := public._check_kiosk_pin(p_group, p_athlete, p_pin);
  -- a wrong code and the try that locks the client both count against the person (otherwise five tries per client would cost them only four misses)
  if v_verdict in ('wrong', 'locked') then
    insert into public.front_desk_pin_misses (caller) values (v_me);
    delete from public.front_desk_pin_misses x where x.caller = v_me and x.missed_at < now() - interval '1 day';
  end if;
  if v_verdict <> 'ok' then
    return jsonb_build_object('result', v_verdict);
  end if;
  insert into public.kiosk_checkins (group_id, athlete_id) values (p_group, p_athlete) returning checked_in_at into v_at;
  return jsonb_build_object('result', 'ok', 'checked_in_at', v_at);
end;
$$;
revoke execute on function public.front_desk_check_in(uuid, uuid, text) from public, anon;
grant execute on function public.front_desk_check_in(uuid, uuid, text) to authenticated, service_role;

-- The owner or an admin removes a front-desk person; the person can also leave. Neither touches anything else.
create or replace function public.remove_front_desk(p_org uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not (public.is_org_active_owner_or_admin(p_org) or p_profile = auth.uid()) then
    raise exception 'Only an owner or admin can remove someone from the front desk.';
  end if;
  delete from public.org_front_desk where organization_id = p_org and profile_id = p_profile;
end;
$$;
revoke execute on function public.remove_front_desk(uuid, uuid) from public, anon;
grant execute on function public.remove_front_desk(uuid, uuid) to authenticated, service_role;

-- The invitation can name the new role.
alter table public.organization_invites drop constraint if exists organization_invites_role_check;
alter table public.organization_invites add constraint organization_invites_role_check check (role in ('admin', 'coach', 'front_desk'));

-- Accepting a front-desk invitation makes the front-desk row, never an organization membership or a group seat. Everything else is exactly as in migration 0352.
create or replace function public.answer_organization_invite(p_invite uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.organization_invites%rowtype;
begin
  select * into inv from public.organization_invites where id = p_invite for update;
  if not found or inv.invited_profile_id is distinct from auth.uid() then
    raise exception 'That invitation was not found.';
  end if;
  if inv.answered_at is not null then
    raise exception 'That invitation has already been answered.';
  end if;
  if inv.expires_at < now() then
    raise exception 'That invitation has expired. Ask for a new one.';
  end if;
  update public.organization_invites set answered_at = now(), accepted = p_accept where id = inv.id;
  if p_accept and inv.role = 'front_desk' then
    insert into public.org_front_desk (organization_id, profile_id, added_by)
    values (inv.organization_id, inv.invited_profile_id, inv.created_by)
    on conflict do nothing;
  elsif p_accept then
    insert into public.organization_memberships (organization_id, profile_id, role)
    values (inv.organization_id, inv.invited_profile_id, inv.role::public.org_member_role)
    on conflict (organization_id, profile_id) do nothing;
    if inv.group_id is not null and exists (select 1 from public.groups g where g.id = inv.group_id and g.organization_id = inv.organization_id and g.group_kind is distinct from 'one_on_one')
       -- never a coach seat in a group that holds a client who is private from the organization (a client can be marked private after the invitation was sent)
       and not exists (select 1 from public.group_memberships a where a.group_id = inv.group_id and a.role = 'athlete' and a.private_from_org) then
      insert into public.group_memberships (group_id, profile_id, role)
      values (inv.group_id, inv.invited_profile_id, 'coach')
      on conflict do nothing;
    end if;
  end if;
  return inv.organization_id;
end;
$$;
revoke execute on function public.answer_organization_invite(uuid, boolean) from public, anon;
grant execute on function public.answer_organization_invite(uuid, boolean) to authenticated, service_role;

-- Closing the organization ends its front desk too. Exactly the 0396 function, plus the one delete.
create or replace function public.close_organization(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m record;
  v_members int := 0;
  v_leaving int := 0;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.organizations where id = p_org and owner_id = me) then
    raise exception 'Only the owner can close the organization.';
  end if;
  for m in select profile_id from public.organization_memberships where organization_id = p_org and profile_id <> me order by created_at, profile_id loop
    if coalesce((public._detach_coach_from_org(p_org, m.profile_id, me, true) ->> 'leaving')::boolean, false) then
      v_leaving := v_leaving + 1;
    end if;
    v_members := v_members + 1;
  end loop;
  update public.organization_invites set answered_at = now(), accepted = false where organization_id = p_org and answered_at is null;
  -- the front desk ends with the team (a front-desk person is not a member, so the loop above does not reach them)
  delete from public.org_front_desk where organization_id = p_org;
  perform public.audit_record('organizations', p_org::text, 'update', jsonb_build_object('event', 'close_organization', 'members_left', v_members, 'still_to_choose', v_leaving, 'closed_by', me));
  return jsonb_build_object('members_left', v_members, 'still_to_choose', v_leaving);
end;
$$;
revoke execute on function public.close_organization(uuid) from public, anon;
grant execute on function public.close_organization(uuid) to authenticated, service_role;

commit;
