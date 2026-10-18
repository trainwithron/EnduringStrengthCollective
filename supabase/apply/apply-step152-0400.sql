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

-- A person sees their own row; an owner or admin sees the organization's. Nobody writes directly: the server (service role) adds, and the functions below remove.
drop policy if exists "org_front_desk_select" on public.org_front_desk;
create policy "org_front_desk_select" on public.org_front_desk for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_org_owner_or_admin(organization_id));

-- Internal. May the signed-in person work this organization's front desk: a front-desk person of it, or an owner, admin or coach of it whose access has not ended.
create or replace function public._front_desk_may_act(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.org_front_desk f where f.organization_id = p_org and f.profile_id = auth.uid())
    or exists (
      select 1 from public.organization_memberships om
      where om.organization_id = p_org and om.profile_id = auth.uid() and om.fired_at is null and om.access_ended_at is null
    )
  )
$$;
revoke execute on function public._front_desk_may_act(uuid) from public, anon, authenticated;

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

-- Find a client by name for the check-in screen: at least two letters, at most 25 answers, only clients who train in a live group of this organization and have not made their records private from it.
-- The answer is a name, the group to check in to, and whether a check-in code has been set.
create or replace function public.front_desk_find(p_org uuid, p_query text)
returns table (athlete_id uuid, group_id uuid, full_name text, has_pin boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null or not public._front_desk_may_act(p_org) then
    raise exception 'not authorized';
  end if;
  if length(q) < 2 then
    return;
  end if;
  return query
    select m.profile_id, m.group_id, p.full_name,
           exists (select 1 from public.kiosk_pins kp where kp.group_id = m.group_id and kp.athlete_id = m.profile_id)
    from public.group_memberships m
    join public.groups g on g.id = m.group_id
    join public.profiles p on p.id = m.profile_id
    where g.organization_id = p_org
      and g.archived_at is null
      and m.role = 'athlete'
      and m.membership_type = 'training'
      and not m.private_from_org
      and p.full_name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    order by p.full_name, m.group_id
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
  v_verdict text;
  v_at timestamptz;
begin
  select g.organization_id into v_org from public.groups g where g.id = p_group and g.archived_at is null;
  if auth.uid() is null or v_org is null or not public._front_desk_may_act(v_org) then
    raise exception 'not authorized';
  end if;
  if not exists (
    select 1 from public.group_memberships m
    where m.group_id = p_group and m.profile_id = p_athlete and m.role = 'athlete' and m.membership_type = 'training' and not m.private_from_org
  ) then
    raise exception 'not authorized';
  end if;
  v_verdict := public._check_kiosk_pin(p_group, p_athlete, p_pin);
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
  if auth.uid() is null or not (public.is_org_owner_or_admin(p_org) or p_profile = auth.uid()) then
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

commit;
