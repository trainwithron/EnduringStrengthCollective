-- UNDO for step 152 (0400). Only if step 152 misbehaves. Run it only while the Release T1 code is not live. Removes the front-desk table (every front-desk person is dropped; they can be invited again) and the functions. The two older functions it replaced (verify_kiosk_pin, answer_organization_invite) keep working for every other role either way.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.remove_front_desk(uuid, uuid);
drop function if exists public.front_desk_check_in(uuid, uuid, text);
drop function if exists public.front_desk_find(uuid, text);
drop function if exists public.front_desk_orgs();
drop function if exists public._front_desk_display_name(text, date);
drop function if exists public._front_desk_scope(uuid);
drop table if exists public.front_desk_pin_misses;
drop table if exists public.org_front_desk;
drop function if exists public.is_org_active_owner_or_admin(uuid);
delete from public.organization_invites where role = 'front_desk';
alter table public.organization_invites drop constraint if exists organization_invites_role_check;
alter table public.organization_invites add constraint organization_invites_role_check check (role in ('admin', 'coach'));
create or replace function public.verify_kiosk_pin(p_group_id uuid, p_athlete_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.kiosk_pins%rowtype;
  v_lock_count int;
begin
  if auth.uid() is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to check kiosk PINs';
  end if;

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
drop function if exists public._check_kiosk_pin(uuid, uuid, text);
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
  if p_accept then
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
  perform public.audit_record('organizations', p_org::text, 'update', jsonb_build_object('event', 'close_organization', 'members_left', v_members, 'still_to_choose', v_leaving, 'closed_by', me));
  return jsonb_build_object('members_left', v_members, 'still_to_choose', v_leaving);
end;
$$;
commit;
