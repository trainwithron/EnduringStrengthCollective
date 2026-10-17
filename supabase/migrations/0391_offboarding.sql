-- 0391: getting out of an organization cleanly. Until now an owner could delete a member's organization row but that left the person coaching the organization's clients, a coach with clients could not leave, and
-- there was no way to change a role, cancel an invitation or end a team. This adds:
--   remove_org_member(org, person, hand_to)   owner or admin: removes a member, and hands the clients only they coach to another member (or, for clients private from the organization, they leave WITH their coach)
--   leave_organization(org, hand_to)          a member leaves the same way (the old one-argument call still works)
--   set_org_member_role(org, person, role)    the owner makes someone an admin or a coach again; an admin can change only coaches
--   cancel_org_invite(invite), extend_org_invite(invite)
--   close_organization(org)                   the owner ends the team: every other member leaves taking the clients they alone coach, each into an organization of their own
-- A client's space is never rebuilt: handing over adds the new coach to the same group and removes the old one, so history, programs, credits and packages stay exactly where they are. A group moved into a
-- member's own organization keeps everything too (it is filed by group, not by organization). The records of who did what go to the audit trail. Money is not touched (a subscription is cancelled by the owner
-- in billing, not here). Re-runnable.

-- A new organization for one coach (their own, the owner), styled like the one they are leaving. Internal.
create or replace function public._solo_org_for(p_coach uuid, p_source_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_name text := coalesce((select nullif(trim(full_name), '') from public.profiles where id = p_coach), 'Coach') || ' coaching';
begin
  insert into public.organizations (slug, name, owner_id, button_shape, accent_color, background_color, text_color, font_display, font_body)
  select 'org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), v_name, p_coach, o.button_shape, o.accent_color, o.background_color, o.text_color, o.font_display, o.font_body
  from public.organizations o where o.id = p_source_org
  returning id into v_org;
  insert into public.organization_memberships (organization_id, profile_id, role) values (v_org, p_coach, 'owner');
  return v_org;
end;
$$;
revoke execute on function public._solo_org_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public._solo_org_for(uuid, uuid) to service_role;

-- Takes a coach out of an organization. For each group of the organization that they coach:
--   - another coach is there too: they just lose their seat;
--   - they are the only coach and p_take is set (closing the organization), or a client in it is private from the organization: the whole group moves into an organization of their own and they keep it;
--   - they are the only coach of a group with clients: p_hand_to becomes its coach and they lose their seat (refused with a plain message when nobody was named);
--   - they are the only coach of an empty group: they lose their seat and the empty group stays.
-- Then the organization membership goes. Internal: the callers check who is allowed.
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
revoke execute on function public._detach_coach_from_org(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public._detach_coach_from_org(uuid, uuid, uuid, boolean) to service_role;

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
revoke execute on function public.remove_org_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.remove_org_member(uuid, uuid, uuid) to authenticated, service_role;

-- Leaving: the same hand-over, chosen by the person leaving. The owner still cannot leave.
drop function if exists public.leave_organization(uuid);
create or replace function public.leave_organization(p_org uuid, p_hand_to uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  result jsonb;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.organization_memberships where organization_id = p_org and profile_id = me) then
    raise exception 'You are not part of that organization.';
  end if;
  if exists (select 1 from public.organizations where id = p_org and owner_id = me) then
    raise exception 'The owner cannot leave. Hand the organization over first.';
  end if;
  result := public._detach_coach_from_org(p_org, me, p_hand_to, false);
  perform public.audit_record('organization_memberships', p_org::text || ':' || me::text, 'update', jsonb_build_object('event', 'leave', 'hand_to', p_hand_to) || result);
  return result;
end;
$$;
revoke execute on function public.leave_organization(uuid, uuid) from public, anon;
grant execute on function public.leave_organization(uuid, uuid) to authenticated, service_role;

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
revoke execute on function public.set_org_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_org_member_role(uuid, uuid, text) to authenticated, service_role;

-- Cancel an invitation that has not been answered, or give it fourteen more days.
create or replace function public.cancel_org_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.organization_invites%rowtype;
begin
  select * into inv from public.organization_invites where id = p_invite for update;
  if not found or auth.uid() is null or not public.is_org_owner_or_admin(inv.organization_id) then
    raise exception 'That invitation was not found.';
  end if;
  if inv.answered_at is not null then
    raise exception 'That invitation has already been answered.';
  end if;
  update public.organization_invites set answered_at = now(), accepted = false where id = p_invite;
end;
$$;
revoke execute on function public.cancel_org_invite(uuid) from public, anon;
grant execute on function public.cancel_org_invite(uuid) to authenticated, service_role;

create or replace function public.extend_org_invite(p_invite uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.organization_invites%rowtype;
  v_until timestamptz := now() + interval '14 days';
begin
  select * into inv from public.organization_invites where id = p_invite for update;
  if not found or auth.uid() is null or not public.is_org_owner_or_admin(inv.organization_id) then
    raise exception 'That invitation was not found.';
  end if;
  if inv.answered_at is not null then
    raise exception 'That invitation has already been answered.';
  end if;
  update public.organization_invites set expires_at = v_until where id = p_invite;
  return v_until;
end;
$$;
revoke execute on function public.extend_org_invite(uuid) from public, anon;
grant execute on function public.extend_org_invite(uuid) to authenticated, service_role;

-- The owner ends the team. Every other member leaves taking the clients they alone coach (each into an organization of their own); a group with several coaches stays with the owner. Open invitations are
-- cancelled. The owner keeps the organization, now their own. Billing is not touched here.
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
revoke execute on function public.close_organization(uuid) from public, anon;
grant execute on function public.close_organization(uuid) to authenticated, service_role;
