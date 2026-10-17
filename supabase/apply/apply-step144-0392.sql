-- STEP 144: 0392 Release H: what a coach coaches (asked at signup) and an owner or admin choosing which coach holds a new client
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release H code is live. Adds one empty column (what a coach coaches: one-on-one clients, a team or class, or a gym) and one function (the owner or admin choosing the coach of a new client). Safe to run before the code is live.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'coach_type'))) then
    raise exception 'Step 144 (0392) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0392_coach_type.sql
-- ====================================================================================================

-- 0392: what a coach coaches, asked once at signup (one-on-one clients, a team or class, a gym with several coaches). Nullable: every coach who signed up before this has no answer and is treated as one-on-one.
alter table public.profiles add column if not exists coach_type text check (coach_type in ('personal', 'team', 'gym'));

-- 0392 also: an owner or admin adding a client chooses which coach in the organization coaches them ("Add client and assign a coach"). The coach is added to the group; the person choosing steps out unless they
-- keep it. A client who keeps their records private from the organization can be handed on only by a coach who already holds the group: an owner or admin who does not coach it can never give themselves (or anyone)
-- a seat there. Re-runnable.
create or replace function public.assign_group_coach(p_group uuid, p_coach uuid, p_drop_me boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_org uuid;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  select organization_id into v_org from public.groups where id = p_group;
  if v_org is null then
    raise exception 'That group was not found.';
  end if;
  if not (public.is_org_owner_or_admin(v_org) or public.is_group_coach(p_group)) then
    raise exception 'Only an owner, an admin or a coach of this group can choose its coach.';
  end if;
  if not exists (select 1 from public.organization_memberships where organization_id = v_org and profile_id = p_coach) then
    raise exception 'Choose a member of this organization.';
  end if;
  if exists (select 1 from public.group_memberships a where a.group_id = p_group and a.role = 'athlete' and a.private_from_org)
     and not public.is_group_coach(p_group) then
    raise exception 'This client keeps their records private from the organization, so only their own coach can hand them on.';
  end if;
  if exists (select 1 from public.group_memberships a where a.group_id = p_group and a.profile_id = p_coach and a.role = 'athlete') then
    raise exception 'That person is a client in this group, so they cannot also coach it.';
  end if;
  insert into public.group_memberships (group_id, profile_id, role) values (p_group, p_coach, 'coach') on conflict do nothing;
  if p_drop_me and p_coach <> me then
    delete from public.group_memberships where group_id = p_group and profile_id = me and role = 'coach';
  end if;
end;
$$;
revoke execute on function public.assign_group_coach(uuid, uuid, boolean) from public, anon;
grant execute on function public.assign_group_coach(uuid, uuid, boolean) to authenticated, service_role;

commit;
