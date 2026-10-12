-- STEP 104: 0358 A personal space: every person can have one space of their own that belongs to no organization, so a coach's own training is one set that follows them into every organization
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen by itself. A coach's own training space is created the first time they open their own client view, named after their profile, and it appears in every organization they coach in as their own row in the Clients list. No organization's owner, admin or rival can read it, and it is in no organization's counts or billing.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.ensure_personal_space()') is null)) then
    raise exception 'Step 104 (0358) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0358_personal_space.sql
-- ====================================================================================================

-- Release BJ: a personal space. One space per person that belongs to the PERSON and to NO organization, so a coach's own training (programs, workout history, nutrition, measurements, check-ins) is one
-- set that follows them into every organization they coach in, and stays theirs when they leave one or hand one over.
--   1. groups.organization_id may be empty. An empty organization marks the personal space; every real group still has one (nothing existing changes).
--   2. One personal space per person (a partial unique index on created_by where there is no organization).
--   3. Only its owner can ever be in it, and only as its coach (a before-insert trigger on memberships, for everyone including the server), so no invite, admin or script can seat anybody else.
--   4. The organization wall (group_in_active_org) lets a group with no organization through under any workspace: the person is its only member and every table's own rules still limit who reads it.
--   5. A program in a personal space is always the owner's own (the one-on-one rule 'a program in a client's own space has to be made for that client' reads the owner as the client there).
--   6. Nothing is written to the notification bell for a personal space (the person would only be told about their own training); the push route also never sends someone a push about their own action.
--   7. public.ensure_personal_space(): a COACH (an organization member or a coach of an organization group) gets their space, created the first time it is asked for, named after their profile. Safe to call again (it returns the same space).
-- No organization owner, admin or rival can read it (those rules join on the group's organization, which is empty here), and no platform-admin rule reads group data. Nothing is moved or deleted.

alter table public.groups alter column organization_id drop not null;

create unique index if not exists groups_one_personal_space_per_person on public.groups (created_by) where organization_id is null;

create or replace function public.guard_personal_space_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_org uuid;
begin
  select g.created_by, g.organization_id into v_owner, v_org from public.groups g where g.id = new.group_id;
  if v_org is null and (new.profile_id is distinct from v_owner or new.role <> 'coach') then
    raise exception 'A personal space belongs to one person.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_personal_space_members() from public, anon, authenticated;

drop trigger if exists group_memberships_guard_personal_space on public.group_memberships;
create trigger group_memberships_guard_personal_space before insert or update of group_id, profile_id, role on public.group_memberships for each row execute function public.guard_personal_space_members();

create or replace function public.guard_one_on_one_program()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_one_on_one_group(new.group_id) then
    return new;
  end if;
  if exists (select 1 from public.groups g where g.id = new.group_id and g.organization_id is null) then
    new.athlete_id := (select g.created_by from public.groups g where g.id = new.group_id);
    return new;
  end if;
  if tg_op = 'UPDATE' and new.group_id is not distinct from old.group_id and new.athlete_id is not distinct from old.athlete_id then
    return new;
  end if;
  if new.athlete_id is null then
    new.athlete_id := public.one_on_one_athlete(new.group_id);
    if new.athlete_id is null then
      raise exception 'A program in a client''s own space has to be made for that client.' using errcode = '23514';
    end if;
  elsif not exists (select 1 from public.group_memberships gm where gm.group_id = new.group_id and gm.profile_id = new.athlete_id and gm.role = 'athlete') then
    raise exception 'A program in a client''s own space has to be made for that client.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_one_on_one_program() from public, anon, authenticated;

create or replace function public.skip_personal_space_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.group_id is not null and exists (select 1 from public.groups g where g.id = new.group_id and g.organization_id is null) then
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.skip_personal_space_notifications() from public, anon, authenticated;

drop trigger if exists notifications_skip_personal_space on public.notifications;
create trigger notifications_skip_personal_space before insert on public.notifications for each row execute function public.skip_personal_space_notifications();

create or replace function public.group_in_active_org(_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.request_workspace_org() is null
      or _group_id is null
      or exists (select 1 from public.groups g where g.id = _group_id and g.organization_id = public.request_workspace_org())
      or exists (select 1 from public.groups g where g.id = _group_id and g.organization_id is null)
$$;

create or replace function public.ensure_personal_space()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_name text;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select g.id into v_id from public.groups g where g.created_by = v_user and g.organization_id is null;
  if v_id is not null then
    return v_id;
  end if;
  -- Only a coach has a personal space (a client or child who asked for one would become a "coach" to every check that looks for a coach membership).
  if not exists (select 1 from public.organization_memberships om where om.profile_id = v_user)
     and not exists (select 1 from public.group_memberships gm join public.groups g on g.id = gm.group_id where gm.profile_id = v_user and gm.role = 'coach' and g.organization_id is not null) then
    raise exception 'Only coaches have a personal space.' using errcode = '42501';
  end if;
  select coalesce(nullif(trim(p.full_name), ''), 'My training') into v_name from public.profiles p where p.id = v_user;
  insert into public.groups (name, group_kind, created_by, organization_id)
  values (coalesce(v_name, 'My training'), 'one_on_one', v_user, null)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select g.id into v_id from public.groups g where g.created_by = v_user and g.organization_id is null;
    return v_id;
  end if;
  insert into public.group_memberships (group_id, profile_id, role) values (v_id, v_user, 'coach');
  return v_id;
end;
$$;
revoke execute on function public.ensure_personal_space() from public, anon;
grant execute on function public.ensure_personal_space() to authenticated, service_role;

commit;
