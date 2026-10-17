-- 0396: a leaving coach is never given an organization they did not ask for. Release H's remove_org_member, leave_organization and close_organization made a new organization (an ownership and billing decision) for
-- every coach whose clients could not stay with the gym. Now nothing moves and nothing is created: those clients stay exactly where they are, the coach keeps their seat in those groups, and their organization
-- membership is kept but marked "leaving" (organization_memberships.departing_since, role back to coach). They choose, in their own time:
--   (a) "Keep my clients and everything: start my own account": a coach plan is bought; when it is paid the server calls complete_departure(), which makes the organization they own and moves their kept groups and
--       their shop links, classes, session types, calendar and the rest into it (this migration builds that function; the purchase itself is a separate release);
--   (b) "Export everything I have": the Export my business zip.
-- Clients the gym owns still go to the member the owner or the coach names. Re-runnable (replaces the 0391 functions).
alter table public.organization_memberships add column if not exists departing_since timestamptz;
-- The groups the coach kept when they were marked leaving: the only groups complete_departure may ever move.
alter table public.organization_memberships add column if not exists departing_group_ids uuid[] not null default '{}';
-- Let go by the organization (fired), when coaching access actually ended, and which notices were sent (each sent once).
alter table public.organization_memberships add column if not exists fired_at timestamptz;
alter table public.organization_memberships add column if not exists access_ended_at timestamptz;
alter table public.organization_memberships add column if not exists departure_notified_at timestamptz;
alter table public.organization_memberships add column if not exists reminded_3d_at timestamptz;
alter table public.organization_memberships add column if not exists reminded_1d_at timestamptz;
alter table public.organization_memberships add column if not exists closure_notified_at timestamptz;
alter table public.organization_memberships add column if not exists clients_notified_at timestamptz;
-- The coach's one export, made once when coaching access ended and kept in a private bucket (no policies: only the server key reaches it), so it never changes after that moment.
alter table public.organization_memberships add column if not exists export_path text;
alter table public.organization_memberships add column if not exists export_created_at timestamptz;
insert into storage.buckets (id, name, public, file_size_limit)
values ('coach-exit-exports', 'coach-exit-exports', false, 524288000)
on conflict (id) do nothing;

-- A member who is leaving is NOT a member for anything organization-wide: the roster, prospects and their contact details, tags, support requests, billing and the rest that are open to "a member of this
-- organization" are closed to them the moment they are marked. What they keep is what belongs to them or to their own clients: their seat in the groups they kept (group membership), the rows filed under
-- their own name (coach_in_org, which reads the membership row directly and is left as it is), and the organization's name and look (can_view_org_branding, through those groups).
create or replace function public.is_org_member(target_org_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = target_org_id and profile_id = auth.uid() and departing_since is null
  );
$$;

-- They can always read their OWN membership row (so the app knows they are leaving), never the roster.
drop policy if exists "org_memberships_select_self" on public.organization_memberships;
create policy "org_memberships_select_self" on public.organization_memberships for select
  to authenticated using (profile_id = (select auth.uid()));

-- Coach seats for the organization's billing: a leaving coach is not a seat.
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
    where organization_id = p_org_id and departing_since is null
  );
end;
$$;

-- Clients the organization is billed for: not the clients of groups a leaving coach kept (the gym cannot see them, and they leave with the coach).
create or replace function public.org_billable_clients(p_org_id uuid)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
      and not exists (
        select 1 from public.organization_memberships om
        where om.organization_id = p_org_id and g.id = any (om.departing_group_ids)
          and not exists (select 1 from public.group_memberships c where c.group_id = g.id and c.role = 'coach' and c.profile_id <> om.profile_id)
      )
  );
end;
$function$;

-- The owner's push address is open to the coaches of the organization (so a coach can alert the owner); not to a coach who is leaving.
drop policy if exists "push_subscriptions_select_org_owner" on public.push_subscriptions;
create policy "push_subscriptions_select_org_owner" on public.push_subscriptions for select
  to authenticated using (
    exists (
      select 1
      from public.organization_memberships om_owner
      join public.organization_memberships om_caller on om_caller.organization_id = om_owner.organization_id
      where om_owner.profile_id = push_subscriptions.profile_id
        and om_owner.role = 'owner'
        and om_caller.profile_id = (select auth.uid())
        and om_caller.departing_since is null
    )
  );

-- A coach who is leaving cannot be made the organization's owner (they are on their way out; ownership would be left with someone who has no membership).
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

  if exists (
    select 1 from public.organization_memberships
    where organization_id = p_organization_id and profile_id = p_new_owner_id and departing_since is not null
  ) then
    raise exception 'That coach is leaving this organization and cannot be made its owner.';
  end if;

  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;
  update public.organization_memberships set role = 'owner'
    where organization_id = p_organization_id and profile_id = p_new_owner_id;
  update public.organization_memberships set role = 'admin'
    where organization_id = p_organization_id and profile_id = v_current_owner;
end;
$function$;

-- Choosing a group's coach: a coach who is leaving cannot be chosen (the live body, with one clause added to the membership check).
create or replace function public.assign_group_coach(p_group uuid, p_coach uuid, p_drop_me boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if not exists (select 1 from public.organization_memberships where organization_id = v_org and profile_id = p_coach and departing_since is null) then
    raise exception 'Choose a member of this organization (not someone who is leaving).';
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
$function$;

-- Same for a role change: a coach who is leaving cannot be made an admin.
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
  target_departing timestamptz;
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
  select role, departing_since into target_role, target_departing from public.organization_memberships where organization_id = p_org and profile_id = p_profile;
  if not found then
    raise exception 'That person is not part of this organization.';
  end if;
  if target_role = 'owner' then
    raise exception 'The owner''s role cannot be changed. Hand the organization over instead.';
  end if;
  if target_departing is not null then
    raise exception 'That coach is leaving this organization, so their role cannot be changed.';
  end if;
  if not caller_is_owner then
    raise exception 'Only the owner can make someone an admin or change an admin.';
  end if;
  update public.organization_memberships set role = p_role::public.org_member_role where organization_id = p_org and profile_id = p_profile;
end;
$$;

-- Takes a coach out of an organization. For each group of the organization that they coach:
--   - another coach is there too: they just lose their seat;
--   - they are the only coach and p_take is set (closing the organization), or a client in it is private from the organization: they KEEP the group and its clients, untouched (they are marked leaving, below);
--   - they are the only coach of a group with clients: p_hand_to becomes its coach and they lose their seat (refused with a plain message when nobody was named);
--   - they are the only coach of an empty group: they lose their seat and the empty group stays.
-- Then, if they kept any group, their membership stays, marked leaving and set back to coach (an admin who is leaving no longer has admin powers); otherwise the membership goes. Internal: the callers check who is allowed.
create or replace function public._detach_coach_from_org(p_org uuid, p_coach uuid, p_hand_to uuid, p_take boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  v_handed int := 0;
  v_kept int := 0;
  v_moved_bookings int := 0;
  v_left_bookings int := 0;
  v_kept_ids uuid[] := '{}';
  v_clients int;
  v_sole boolean;
  v_private boolean;
  n int;
begin
  -- A coach who is already leaving (or was let go, or whose days ran out) is not touched again: removing them a second time, or closing the organization, must not wipe what records their departure.
  if exists (select 1 from public.organization_memberships where organization_id = p_org and profile_id = p_coach and departing_since is not null) then
    return jsonb_build_object('handed', 0, 'kept', 0, 'leaving', true, 'already', true, 'bookings_moved', 0, 'bookings_left', 0);
  end if;
  if p_hand_to is not null and (p_hand_to = p_coach or not exists (select 1 from public.organization_memberships where organization_id = p_org and profile_id = p_hand_to and departing_since is null)) then
    raise exception 'Choose another member of this organization to take over (not someone who is leaving).';
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
      -- the coach keeps this group and its clients exactly as they are, until they choose what to do
      v_kept := v_kept + 1;
      v_kept_ids := v_kept_ids || g.group_id;
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

  if v_kept > 0 then
    update public.organization_memberships
      set departing_since = coalesce(departing_since, now()),
          role = 'coach',
          departing_group_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(departing_group_ids || v_kept_ids) as x)
      where organization_id = p_org and profile_id = p_coach;
  else
    delete from public.organization_memberships where organization_id = p_org and profile_id = p_coach;
  end if;
  return jsonb_build_object('handed', v_handed, 'kept', v_kept, 'leaving', v_kept > 0, 'bookings_moved', v_moved_bookings, 'bookings_left', v_left_bookings);
end;
$$;
revoke execute on function public._detach_coach_from_org(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public._detach_coach_from_org(uuid, uuid, uuid, boolean) to service_role;

-- The owner ends the team: every other member goes through the same step with p_take set, so each coach keeps the clients only they coach (marked leaving, choosing in their own time) and the owner keeps the rest.
-- Open invitations are cancelled. Billing is not touched.
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
    if coalesce((public._detach_coach_from_org(p_org, m.profile_id, null, true) ->> 'leaving')::boolean, false) then
      v_leaving := v_leaving + 1;
    end if;
    v_members := v_members + 1;
  end loop;
  update public.organization_invites set answered_at = now(), accepted = false where organization_id = p_org and answered_at is null;
  perform public.audit_record('organizations', p_org::text, 'update', jsonb_build_object('event', 'close_organization', 'members_left', v_members, 'still_to_choose', v_leaving, 'closed_by', me));
  return jsonb_build_object('members_left', v_members, 'still_to_choose', v_leaving);
end;
$$;
revoke execute on function public.close_organization(uuid) from public, anon;
grant execute on function public.close_organization(uuid) to authenticated, service_role;

-- The server only, when a leaving coach's plan is paid: the coach gets the organization they own, and the groups they kept, their shop links, partners, session types, challenges, calendar entries, discovery calls,
-- briefings and classes move into it; their membership in the old organization ends. Refused unless the coach is marked leaving. Returns the new organization.
create or replace function public.complete_departure(p_org uuid, p_coach uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_role text := current_setting('request.jwt.claim.role', true);
  v_new uuid;
  v_groups int := 0;
  v_kept uuid[];
  v_fired timestamptz;
  v_ended timestamptz;
  v_since timestamptz;
begin
  -- the membership row is locked, so a retried or simultaneous call waits and then finds the coach already gone
  select departing_group_ids, fired_at, access_ended_at, departing_since into v_kept, v_fired, v_ended, v_since from public.organization_memberships
    where organization_id = p_org and profile_id = p_coach and departing_since is not null for update;
  if not found then
    raise exception 'That coach is not leaving this organization.';
  end if;
  if v_fired is not null then
    raise exception 'A coach who was let go cannot start their own account here.';
  end if;
  if v_ended is not null or v_since <= now() - interval '7 days' then
    raise exception 'The seven days to choose have ended.';
  end if;
  if exists (select 1 from public.organizations where id = p_org and owner_id = p_coach) then
    raise exception 'The owner of an organization cannot leave it this way.';
  end if;
  v_new := public._solo_org_for(p_coach, p_org);

  perform set_config('request.jwt.claim.role', 'service_role', true);
  -- only the groups they kept when they were marked leaving (never a group the organization owns)
  update public.groups g set organization_id = v_new
    where g.organization_id = p_org
      and g.id = any (v_kept)
      and exists (select 1 from public.group_memberships c where c.group_id = g.id and c.profile_id = p_coach and c.role = 'coach');
  get diagnostics v_groups = row_count;
  update public.pro_shop_links set organization_id = v_new where organization_id = p_org and coach_id = p_coach;
  update public.referral_partners set organization_id = v_new where organization_id = p_org and coach_id = p_coach;
  update public.session_types set organization_id = v_new where organization_id = p_org and coach_id = p_coach;
  update public.challenges set organization_id = v_new where organization_id = p_org and coach_id = p_coach;
  update public.calendar_events set organization_id = v_new where organization_id = p_org and coach_id = p_coach;
  update public.discovery_bookings set organization_id = v_new where organization_id = p_org and coach_id = p_coach;
  update public.coach_briefings set organization_id = v_new where organization_id = p_org and coach_id = p_coach;
  -- classes belong to the coach (no group) and follow them; an event belongs to its group and follows the group only if the group moved
  update public.group_sessions set organization_id = v_new
    where organization_id = p_org and coach_id = p_coach and (group_id is null or group_id in (select id from public.groups where organization_id = v_new));
  perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);

  delete from public.organization_memberships where organization_id = p_org and profile_id = p_coach;
  perform public.audit_record('organization_memberships', p_org::text || ':' || p_coach::text, 'update', jsonb_build_object('event', 'complete_departure', 'new_organization', v_new, 'groups', v_groups));
  return jsonb_build_object('organization_id', v_new, 'groups', v_groups);
end;
$$;
revoke execute on function public.complete_departure(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_departure(uuid, uuid) to service_role;

-- The rows a coach files under their own name (shop links, classes, session types, calendar...) are theirs only while they still have coaching access: not once they were let go or their days ended.
create or replace function public.coach_in_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is null or exists (
    select 1 from public.organization_memberships om
    where om.organization_id = p_org and om.profile_id = auth.uid() and om.fired_at is null and om.access_ended_at is null
  )
$$;

-- Coaching access ends: the coach's seats in the groups they kept are taken away (the clients, their records and their history stay exactly where they are, private from the organization and with
-- no coach), and the moment is recorded. Internal.
create or replace function public._end_coach_access(p_org uuid, p_coach uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select departing_group_ids into v_ids from public.organization_memberships
    where organization_id = p_org and profile_id = p_coach and departing_since is not null and access_ended_at is null for update;
  if not found then
    return;
  end if;
  delete from public.group_memberships where profile_id = p_coach and role = 'coach' and group_id = any (v_ids);
  update public.organization_memberships set access_ended_at = now() where organization_id = p_org and profile_id = p_coach;
end;
$$;
revoke execute on function public._end_coach_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public._end_coach_access(uuid, uuid) to service_role;

-- The server's daily job, seven days after a coach was marked leaving (and not let go, not already ended): coaching access ends. Returns whether it did.
create or replace function public.end_departure_access(p_org uuid, p_coach uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organization_memberships
    where organization_id = p_org and profile_id = p_coach and departing_since is not null and fired_at is null and access_ended_at is null
      and departing_since <= now() - interval '7 days'
  ) then
    return false;
  end if;
  perform public._end_coach_access(p_org, p_coach);
  perform public.audit_record('organization_memberships', p_org::text || ':' || p_coach::text, 'update', jsonb_build_object('event', 'departure_window_ended'));
  return true;
end;
$$;
revoke execute on function public.end_departure_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_departure_access(uuid, uuid) to service_role;

-- The owner or an admin removes a coach and says which kind it is: p_fired false = they are leaving on good terms (seven days to choose), true = they are being let go (coaching access ends at once, and the
-- coach cannot start their own account here). Replaces the three-argument version (which keeps working: p_fired defaults to false).
drop function if exists public.remove_org_member(uuid, uuid, uuid);
create or replace function public.remove_org_member(p_org uuid, p_profile uuid, p_hand_to uuid default null, p_fired boolean default false)
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
  if p_fired and coalesce((result ->> 'leaving')::boolean, false) then
    update public.organization_memberships set fired_at = coalesce(fired_at, now()) where organization_id = p_org and profile_id = p_profile;
    perform public._end_coach_access(p_org, p_profile);
  end if;
  perform public.audit_record('organization_memberships', p_org::text || ':' || p_profile::text, 'update', jsonb_build_object('event', 'remove_member', 'removed_by', me, 'hand_to', p_hand_to, 'fired', p_fired) || result);
  return result;
end;
$$;
revoke execute on function public.remove_org_member(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.remove_org_member(uuid, uuid, uuid, boolean) to authenticated, service_role;

-- Only a platform administrator: lifts a "let go" (or an ended window): the coach's seats come back, and they get a fresh seven days to choose.
create or replace function public.lift_departure_block(p_org uuid, p_coach uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null or not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only a platform administrator can do that.';
  end if;
  select departing_group_ids into v_ids from public.organization_memberships
    where organization_id = p_org and profile_id = p_coach and departing_since is not null for update;
  if not found then
    raise exception 'That coach is not leaving this organization.';
  end if;
  insert into public.group_memberships (group_id, profile_id, role)
    select g.id, p_coach, 'coach' from public.groups g where g.id = any (v_ids) and g.organization_id = p_org
    on conflict do nothing;
  update public.organization_memberships
    set fired_at = null, access_ended_at = null, departing_since = now(),
        departure_notified_at = null, reminded_3d_at = null, reminded_1d_at = null, closure_notified_at = null,
        clients_notified_at = null, export_path = null, export_created_at = null
    where organization_id = p_org and profile_id = p_coach;
  perform public.audit_record('organization_memberships', p_org::text || ':' || p_coach::text, 'update', jsonb_build_object('event', 'lift_departure_block', 'by', auth.uid()));
end;
$$;
revoke execute on function public.lift_departure_block(uuid, uuid) from public, anon;
grant execute on function public.lift_departure_block(uuid, uuid) to authenticated, service_role;

-- Two new kinds of notice: the reminder to a leaving coach, and the notice to a closed coach's clients.
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['coach_departure_reminder', 'coach_account_closed']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

-- The solo-organization helper is kept (complete_departure uses it) and stays server-only; remove_org_member and leave_organization (0391) already call _detach_coach_from_org and so need no change.
