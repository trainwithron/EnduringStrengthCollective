-- UNDO for step 148 (0396). Only if step 148 misbehaves. Run it only while the Release L code is not live (the Team page, Home and the announcement read the column). Coaches already marked leaving lose the mark and become ordinary members of that organization again, still coaching the clients they kept.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
create or replace function public.is_org_member(target_org_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = target_org_id and profile_id = auth.uid()
  );
$$;
create or replace function public.org_coach_seats(p_org_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not (coalesce(public.is_org_member(p_org_id), false) or coalesce(public.is_platform_admin(), false)) then
    raise exception 'Not authorized';
  end if;

  return (
    select count(distinct profile_id)::int
    from public.organization_memberships
    where organization_id = p_org_id
  );
end;
$$;
create or replace function public.org_billable_clients(p_org_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not (coalesce(public.is_org_member(p_org_id), false) or coalesce(public.is_platform_admin(), false)) then
    raise exception 'Not authorized';
  end if;

  return (
    select count(distinct m.profile_id)::int
    from public.groups g
    join public.group_memberships m on m.group_id = g.id
    where g.organization_id = p_org_id
      and m.role = 'athlete'
      and m.membership_type = 'training'
  );
end;
$$;
create or replace function public.transfer_organization_ownership(p_organization_id uuid, p_new_owner_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current_owner uuid;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'Not authorized to transfer organization ownership';
  end if;

  select owner_id into v_current_owner from public.organizations where id = p_organization_id;
  if v_current_owner is null then
    raise exception 'Organization not found';
  end if;

  if v_current_owner <> auth.uid()
     and not exists (select 1 from public.profiles where id = auth.uid() and is_platform_admin)
  then
    raise exception 'Only the current owner or a platform admin can transfer ownership';
  end if;

  if p_new_owner_id = v_current_owner then
    raise exception 'That person already owns this organization';
  end if;

  if not exists (
    select 1 from public.organization_memberships
    where organization_id = p_organization_id and profile_id = p_new_owner_id
  ) then
    raise exception 'The new owner must already be a member of this organization';
  end if;

  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;
  update public.organization_memberships set role = 'owner'
    where organization_id = p_organization_id and profile_id = p_new_owner_id;
  update public.organization_memberships set role = 'admin'
    where organization_id = p_organization_id and profile_id = v_current_owner;
end;
$function$;
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
create or replace function public.set_org_member_role(p_org uuid, p_profile uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  caller_is_owner boolean;
  target_role public.org_member_role;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not public.is_org_owner_or_admin(p_org) then
    raise exception 'Only an owner or admin can change a role.';
  end if;
  if p_role not in ('admin', 'coach') then
    raise exception 'A role is admin or coach. Ownership is handed over, not assigned.';
  end if;
  caller_is_owner := exists (select 1 from public.organizations where id = p_org and owner_id = me);
  select role into target_role from public.organization_memberships where organization_id = p_org and profile_id = p_profile;
  if not found then
    raise exception 'That person is not part of this organization.';
  end if;
  if target_role = 'owner' then
    raise exception 'The owner''s role cannot be changed. Hand the organization over instead.';
  end if;
  if not caller_is_owner then
    raise exception 'Only the owner can make someone an admin or change an admin.';
  end if;
  update public.organization_memberships set role = p_role::public.org_member_role where organization_id = p_org and profile_id = p_profile;
end;
$$;
create or replace function public._detach_coach_from_org(p_org uuid, p_coach uuid, p_hand_to uuid, p_take boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_role text := current_setting('request.jwt.claim.role', true);
  g record;
  v_solo uuid;
  v_handed int := 0;
  v_taken int := 0;
  v_moved_bookings int := 0;
  v_left_bookings int := 0;
  v_clients int;
  v_sole boolean;
  v_private boolean;
  n int;
begin
  if p_hand_to is not null and (p_hand_to = p_coach or not exists (select 1 from public.organization_memberships where organization_id = p_org and profile_id = p_hand_to)) then
    raise exception 'Choose another member of this organization to take over.';
  end if;

  for g in
    select gm.group_id, gr.name
    from public.group_memberships gm
    join public.groups gr on gr.id = gm.group_id
    where gm.profile_id = p_coach and gm.role = 'coach' and gr.organization_id = p_org
    order by gr.name
  loop
    v_sole := not exists (select 1 from public.group_memberships o where o.group_id = g.group_id and o.role = 'coach' and o.profile_id <> p_coach);
    select count(*) into v_clients from public.group_memberships a where a.group_id = g.group_id and a.role = 'athlete';
    v_private := exists (select 1 from public.group_memberships a where a.group_id = g.group_id and a.role = 'athlete' and a.private_from_org);

    if v_sole and (p_take or v_private) then
      -- the group goes with its coach, into an organization of their own
      if v_solo is null then
        v_solo := public._solo_org_for(p_coach, p_org);
      end if;
      perform set_config('request.jwt.claim.role', 'service_role', true);
      update public.groups set organization_id = v_solo where id = g.group_id;
      perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);
      v_taken := v_taken + 1;
    elsif v_sole and v_clients > 0 then
      if p_hand_to is null then
        raise exception 'Choose who takes over % client% first: % has nobody else coaching.', v_clients, case when v_clients = 1 then '' else 's' end, g.name;
      end if;
      if exists (select 1 from public.group_memberships a where a.group_id = g.group_id and a.profile_id = p_hand_to and a.role = 'athlete') then
        raise exception 'The person chosen to take over is a client in %. Choose someone else.', g.name;
      end if;
      insert into public.group_memberships (group_id, profile_id, role) values (g.group_id, p_hand_to, 'coach') on conflict do nothing;
      -- never take the leaving coach's seat away unless the new coach really holds one
      if not exists (select 1 from public.group_memberships c where c.group_id = g.group_id and c.profile_id = p_hand_to and c.role = 'coach') then
        raise exception 'Could not make the chosen person the coach of %. Choose someone else.', g.name;
      end if;
      -- their future confirmed bookings in this group go to the new coach where that coach is free; any that clash stay and are counted
      update public.bookings b set coach_id = p_hand_to
        where b.group_id = g.group_id and b.coach_id = p_coach and b.status = 'confirmed' and b.start_at > now()
          and not exists (select 1 from public.bookings x where x.coach_id = p_hand_to and x.start_at = b.start_at and x.status = 'confirmed');
      get diagnostics n = row_count;
      v_moved_bookings := v_moved_bookings + n;
      select count(*) into n from public.bookings b where b.group_id = g.group_id and b.coach_id = p_coach and b.status = 'confirmed' and b.start_at > now();
      v_left_bookings := v_left_bookings + n;
      delete from public.group_memberships where group_id = g.group_id and profile_id = p_coach and role = 'coach';
      v_handed := v_handed + 1;
    else
      delete from public.group_memberships where group_id = g.group_id and profile_id = p_coach and role = 'coach';
    end if;
  end loop;

  -- A coach who left with clients into an organization of their own takes their own business rows along (shop links, partners, session types, challenges, calendar entries, discovery calls, briefings, and the
  -- classes of the groups that moved), so they and their clients keep their shop, classes and calendar. A coach whose clients stayed with the gym leaves those rows with the gym.
  if v_solo is not null then
    perform set_config('request.jwt.claim.role', 'service_role', true);
    update public.pro_shop_links set organization_id = v_solo where organization_id = p_org and coach_id = p_coach;
    update public.referral_partners set organization_id = v_solo where organization_id = p_org and coach_id = p_coach;
    update public.session_types set organization_id = v_solo where organization_id = p_org and coach_id = p_coach;
    update public.challenges set organization_id = v_solo where organization_id = p_org and coach_id = p_coach;
    update public.calendar_events set organization_id = v_solo where organization_id = p_org and coach_id = p_coach;
    update public.discovery_bookings set organization_id = v_solo where organization_id = p_org and coach_id = p_coach;
    update public.coach_briefings set organization_id = v_solo where organization_id = p_org and coach_id = p_coach;
    -- classes belong to the coach (no group) and follow them; an event belongs to its group and follows the group only if the group moved
    update public.group_sessions set organization_id = v_solo
      where organization_id = p_org and coach_id = p_coach and (group_id is null or group_id in (select id from public.groups where organization_id = v_solo));
    perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);
  end if;

  delete from public.organization_memberships where organization_id = p_org and profile_id = p_coach;
  return jsonb_build_object('handed', v_handed, 'taken', v_taken, 'bookings_moved', v_moved_bookings, 'bookings_left', v_left_bookings);
end;
$$;
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
  v_taken int := 0;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.organizations where id = p_org and owner_id = me) then
    raise exception 'Only the owner can close the organization.';
  end if;
  for m in select profile_id from public.organization_memberships where organization_id = p_org and profile_id <> me order by created_at, profile_id loop
    v_taken := v_taken + coalesce((public._detach_coach_from_org(p_org, m.profile_id, null, true) ->> 'taken')::int, 0);
    v_members := v_members + 1;
  end loop;
  update public.organization_invites set answered_at = now(), accepted = false where organization_id = p_org and answered_at is null;
  perform public.audit_record('organizations', p_org::text, 'update', jsonb_build_object('event', 'close_organization', 'members_left', v_members, 'groups_moved', v_taken, 'closed_by', me));
  return jsonb_build_object('members_left', v_members, 'groups_moved', v_taken);
end;
$$;
drop function if exists public.lift_departure_block(uuid, uuid);
drop function if exists public.end_departure_access(uuid, uuid);
drop function if exists public._end_coach_access(uuid, uuid);
drop function if exists public.remove_org_member(uuid, uuid, uuid, boolean);
create or replace function public.remove_org_member(p_org uuid, p_profile uuid, p_hand_to uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_role public.org_member_role;
  result jsonb;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not public.is_org_owner_or_admin(p_org) then
    raise exception 'Only an owner or admin can remove a member.';
  end if;
  select role into target_role from public.organization_memberships where organization_id = p_org and profile_id = p_profile;
  if not found then
    raise exception 'That person is not part of this organization.';
  end if;
  if p_profile = me then
    raise exception 'To leave yourself, use Leave.';
  end if;
  if target_role = 'owner' then
    raise exception 'The owner cannot be removed. Hand the organization over first.';
  end if;
  if target_role = 'admin' and not exists (select 1 from public.organizations where id = p_org and owner_id = me) then
    raise exception 'Only the owner can remove an admin.';
  end if;
  result := public._detach_coach_from_org(p_org, p_profile, p_hand_to, false);
  perform public.audit_record('organization_memberships', p_org::text || ':' || p_profile::text, 'update', jsonb_build_object('event', 'remove_member', 'removed_by', me, 'hand_to', p_hand_to) || result);
  return result;
end;
$$;
grant execute on function public.remove_org_member(uuid, uuid, uuid) to authenticated, service_role;
-- the two extra notification kinds are left in the list (removing them could break rows that use them)
drop policy if exists "push_subscriptions_select_org_owner" on public.push_subscriptions;
create policy "push_subscriptions_select_org_owner" on public.push_subscriptions for select to authenticated using (exists (select 1 from public.organization_memberships om_owner join public.organization_memberships om_caller on om_caller.organization_id = om_owner.organization_id where om_owner.profile_id = push_subscriptions.profile_id and om_owner.role = 'owner' and om_caller.profile_id = (select auth.uid())));
drop policy if exists "org_memberships_select_self" on public.organization_memberships;
drop function if exists public.complete_departure(uuid, uuid);
alter table public.organization_memberships drop column if exists closure_notified_at, drop column if exists reminded_1d_at, drop column if exists reminded_3d_at, drop column if exists departure_notified_at, drop column if exists access_ended_at, drop column if exists fired_at;
alter table public.organization_memberships drop column if exists departing_group_ids;
alter table public.organization_memberships drop column if exists departing_since;
commit;
