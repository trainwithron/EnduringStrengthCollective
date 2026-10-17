-- 0392: what a coach coaches, asked once at signup (one-on-one clients, a team or class, a gym with several coaches). Nullable: every coach who signed up before this has no answer and is treated as one-on-one.
alter table public.profiles add column if not exists coach_type text check (coach_type in ('personal', 'team', 'gym'));

-- 0392 also: an owner or admin adding a client chooses which coach in the organization coaches them ("Add client and assign a coach"). The coach is added to the group; the person choosing steps out unless they
-- keep it. Never for a client who keeps their records private from the organization (only their own coach can hold them). Re-runnable.
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
  if p_coach <> me and exists (select 1 from public.group_memberships a where a.group_id = p_group and a.role = 'athlete' and a.private_from_org) then
    raise exception 'This client keeps their records private from the organization, so only their own coach can hold them.';
  end if;
  insert into public.group_memberships (group_id, profile_id, role) values (p_group, p_coach, 'coach') on conflict do nothing;
  if p_drop_me and p_coach <> me then
    delete from public.group_memberships where group_id = p_group and profile_id = me and role = 'coach';
  end if;
end;
$$;
revoke execute on function public.assign_group_coach(uuid, uuid, boolean) from public, anon;
grant execute on function public.assign_group_coach(uuid, uuid, boolean) to authenticated, service_role;
