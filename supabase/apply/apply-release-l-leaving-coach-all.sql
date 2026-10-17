-- RELEASE L (A LEAVING COACH IS NEVER GIVEN AN ORGANIZATION; ADDS ONLY, SAFE TO RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 148 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 148: Nothing changes on screen until the Release L code is live. Adds one empty column (when a coach was marked leaving) and replaces the remove / leave / close organization steps so none of them creates an organization. A coach marked leaving keeps their clients exactly where they are. Safe to run before the code is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release L (a leaving coach is never given an organization; adds only, safe to run BEFORE the code that goes with it is live), step 148: 0396 Release L: a leaving coach is never given an organization (their clients stay where they are, they are marked leaving and choose); the finishing step is server-only
do $g148$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0396 is not already applied (the leaving mark is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'departing_since')),
      ('the offboarding steps it replaces exist (step 143 is applied)', to_regprocedure('public.remove_org_member(uuid, uuid, uuid)') is not null and to_regprocedure('public._detach_coach_from_org(uuid, uuid, uuid, boolean)') is not null and to_regprocedure('public._solo_org_for(uuid, uuid)') is not null),
      ('the audit writer exists', to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release L (a leaving coach is never given an organization; adds only, safe to run BEFORE the code that goes with it is live), step 148 (0396) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g148$;

-- ====================================================================================================
-- migration 0396_leaving_coach_choice.sql
-- ====================================================================================================

-- 0396: a leaving coach is never given an organization they did not ask for. Release H's remove_org_member, leave_organization and close_organization made a new organization (an ownership and billing decision) for
-- every coach whose clients could not stay with the gym. Now nothing moves and nothing is created: those clients stay exactly where they are, the coach keeps their seat in those groups, and their organization
-- membership is kept but marked "leaving" (organization_memberships.departing_since, role back to coach). They choose, in their own time:
--   (a) "Keep my clients and everything: start my own account": a coach plan is bought; when it is paid the server calls complete_departure(), which makes the organization they own and moves their kept groups and
--       their shop links, classes, session types, calendar and the rest into it (this migration builds that function; the purchase itself is a separate release);
--   (b) "Export everything I have": the Export my business zip.
-- Clients the gym owns still go to the member the owner or the coach names. Re-runnable (replaces the 0391 functions).
alter table public.organization_memberships add column if not exists departing_since timestamptz;

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
      -- the coach keeps this group and its clients exactly as they are, until they choose what to do
      v_kept := v_kept + 1;
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
    update public.organization_memberships set departing_since = coalesce(departing_since, now()), role = 'coach' where organization_id = p_org and profile_id = p_coach;
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
begin
  if not exists (select 1 from public.organization_memberships where organization_id = p_org and profile_id = p_coach and departing_since is not null) then
    raise exception 'That coach is not leaving this organization.';
  end if;
  v_new := public._solo_org_for(p_coach, p_org);

  perform set_config('request.jwt.claim.role', 'service_role', true);
  -- the groups only they coach (their clients), which they kept
  update public.groups g set organization_id = v_new
    where g.organization_id = p_org
      and exists (select 1 from public.group_memberships c where c.group_id = g.id and c.profile_id = p_coach and c.role = 'coach')
      and not exists (select 1 from public.group_memberships o where o.group_id = g.id and o.role = 'coach' and o.profile_id <> p_coach);
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

-- The solo-organization helper is kept (complete_departure uses it) and stays server-only; remove_org_member and leave_organization (0391) already call _detach_coach_from_org and so need no change.

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 148 (0396)' as step, '0396 Release L: a leaving coach is never given an organization' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'departing_since'))) as in_place
) as result order by step;
