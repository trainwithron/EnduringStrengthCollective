-- RELEASE H (UNDO A WHOLE HISTORY IMPORT; GETTING OUT OF AN ORGANIZATION; WHAT A COACH COACHES; ADDS ONLY, SAFE TO RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 142, 143, 144 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 142: Nothing changes on screen. Imports made after the Release H code is live can be undone as one batch from the History page; imports made before have no batch and are still deleted one workout at a time. Adds one empty column and an index. Safe to run before the code is live.
-- AFTER STEP 143: Nothing changes on screen until the Release H code is live (the Team page calls these). Adds functions only; it replaces leave_organization with a version that can hand clients over (the old one-argument call still works). Safe to run before the code is live.
-- AFTER STEP 144: Nothing changes on screen until the Release H code is live. Adds one empty column (what a coach coaches: one-on-one clients, a team or class, or a gym) and one function (the owner or admin choosing the coach of a new client). Safe to run before the code is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release H (undo a whole history import; getting out of an organization; what a coach coaches; adds only, safe to run BEFORE the code that goes with it is live), step 142: 0390 Release H: undo a whole history import (every workout an import creates carries one batch id)
do $g142$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0390 is not already applied (the batch column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id')),
      ('the table it builds on exists', to_regclass('public.athlete_sessions') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release H (undo a whole history import; getting out of an organization; what a coach coaches; adds only, safe to run BEFORE the code that goes with it is live), step 142 (0390) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g142$;

-- ====================================================================================================
-- migration 0390_import_batch_undo.sql
-- ====================================================================================================

-- 0390: undo a whole history import. Every workout an import creates carries the same batch id, so "Undo this import" removes exactly that import's entries (and nothing the person logged live).
-- Adds one nullable column and one index. Safe to run before the code that uses it is live.
alter table public.athlete_sessions add column if not exists import_batch_id uuid;
create index if not exists athlete_sessions_import_batch_idx on public.athlete_sessions (import_batch_id) where import_batch_id is not null;

-- ===== Release H (undo a whole history import; getting out of an organization; what a coach coaches; adds only, safe to run BEFORE the code that goes with it is live), step 143: 0391 Release H: getting out of an organization (remove a member and hand over their clients, leave, change a role, cancel or extend an invitation, close the organization)
do $g143$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0391 is not already applied (the remove function is not there yet)', to_regprocedure('public.remove_org_member(uuid, uuid, uuid)') is null),
      ('the tables it builds on exist', to_regclass('public.organization_memberships') is not null and to_regclass('public.organization_invites') is not null and to_regclass('public.audit_log') is not null and to_regclass('public.bookings') is not null),
      ('the helper functions it uses exist', to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release H (undo a whole history import; getting out of an organization; what a coach coaches; adds only, safe to run BEFORE the code that goes with it is live), step 143 (0391) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g143$;

-- ====================================================================================================
-- migration 0391_offboarding.sql
-- ====================================================================================================

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

-- ===== Release H (undo a whole history import; getting out of an organization; what a coach coaches; adds only, safe to run BEFORE the code that goes with it is live), step 144: 0392 Release H: what a coach coaches (asked at signup) and an owner or admin choosing which coach holds a new client
do $g144$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0392 is not already applied (the coach type column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'coach_type')),
      ('the tables it builds on exist', to_regclass('public.profiles') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.organization_memberships') is not null),
      ('the helper functions it uses exist', to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release H (undo a whole history import; getting out of an organization; what a coach coaches; adds only, safe to run BEFORE the code that goes with it is live), step 144 (0392) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g144$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 142 (0390)' as step, '0390 Release H: undo a whole history import' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id'))) as in_place
  union all
  select 'step 143 (0391)' as step, '0391 Release H: getting out of an organization' as what, not ((to_regprocedure('public.remove_org_member(uuid, uuid, uuid)') is null)) as in_place
  union all
  select 'step 144 (0392)' as step, '0392 Release H: what a coach coaches' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'coach_type'))) as in_place
) as result order by step;
