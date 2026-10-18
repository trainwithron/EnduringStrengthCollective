-- Release AF3, the database policies from the post-ship audit. One re-runnable file:
--
--  1. A client who is private from the organization is also private in the feed and in tags. An organization owner or admin could still read the POSTS of a client the coach marked private (the group-level
--     rule existed, the client-level one did not: messages, sessions and the rest already had it), and still see which TAGS such a client has. The coach of the group is unchanged.
--  2. Deleting a person's account is no longer blocked by two links nobody had decided about: the sub-goal someone proposed (client_sub_goals.proposed_by) and the assessment someone recorded
--     (client_assessments.created_by). Both go with the person, like their goals and notes. A live-catalog check in the rehearsal fails if a new not-null link to a profile is ever added without a decision.
--  3. The guardian-consent answer for a COACH is now limited to a coach of a group where the person is a TRAINING client and the group is live (not archived). A coach of a social-only seat, or of a group that was
--     retired, no longer sees whether a child's guardian has signed. The child still sees their own.
--  4. When a person's last client seat is removed the health-form flag is cleared (profiles.intake_required). Adding a seat back sets it again when the form was never completed (the 0403 trigger), so nobody
--     skips the form. Nothing else about removing a client changes.
-- Replaces: the two posts policies, one tag policy, profile_reference_policy() and guardian_consent_state(). Adds: two small functions, one trigger.

-- ---- 1. private-from-the-organization, for posts and tags -------------------------------------------------------------------------------------------------
drop policy if exists "posts_select_members" on public.posts;
create policy "posts_select_members" on public.posts for select to authenticated
  using (public.is_group_member(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id) and not public.is_client_private_from_org(group_id, author_id)));

drop policy if exists "posts_delete_own_or_coach" on public.posts;
create policy "posts_delete_own_or_coach" on public.posts for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id) and not public.is_client_private_from_org(group_id, author_id)));

-- Is this person marked private from the organization in ANY group of it? A tag belongs to the organization, not to one group, so one private seat is enough to keep the person's tags from its owner and admins.
create or replace function public.athlete_private_from_org(p_athlete uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships m
    join public.groups g on g.id = m.group_id
    where m.profile_id = p_athlete and g.organization_id = p_org and m.private_from_org
  )
$$;
revoke all on function public.athlete_private_from_org(uuid, uuid) from public, anon;
grant execute on function public.athlete_private_from_org(uuid, uuid) to authenticated, service_role;

drop policy if exists "client_tag_assignments_select_org_member" on public.client_tag_assignments;
create policy "client_tag_assignments_select_org_member" on public.client_tag_assignments for select
  to authenticated using (
    exists (
      select 1 from public.client_tags t
      where t.id = client_tag_assignments.tag_id
        and (
          (public.is_org_owner_or_admin(t.organization_id) and not public.athlete_private_from_org(client_tag_assignments.athlete_id, t.organization_id))
          or exists (
            select 1 from public.group_memberships c
            join public.group_memberships a on a.group_id = c.group_id
            where c.profile_id = (select auth.uid()) and c.role = 'coach' and a.profile_id = client_tag_assignments.athlete_id
          )
        )
    )
  );

-- ---- 2. the two links nobody had decided about ---------------------------------------------------------------------------------------------------------
create or replace function public.profile_reference_policy()
returns table (tbl text, col text, action text)
language sql
immutable
set search_path = pg_catalog
as $$
  select * from (values
    -- meaningless without the person: delete the row
    ('athlete_exercise_overrides', 'created_by', 'delete'),
    ('athlete_notes', 'created_by', 'delete'),
    ('client_assessments', 'created_by', 'delete'),
    ('client_goals', 'created_by', 'delete'),
    ('client_habits', 'created_by', 'delete'),
    ('client_sub_goals', 'proposed_by', 'delete'),
    ('client_tags', 'created_by', 'delete'),
    ('coach_video_checkins', 'created_by', 'delete'),
    ('daily_macros', 'created_by', 'delete'),
    ('exercise_progressions', 'created_by', 'delete'),
    ('group_invites', 'created_by', 'delete'),
    ('guardian_links', 'created_by', 'delete'),
    ('meal_plans', 'created_by', 'delete'),
    ('nutrition_checkins', 'created_by', 'delete'),
    ('nutrition_phases', 'created_by', 'delete'),
    ('org_trainer_dispatch_questions', 'trainer_id', 'delete'),
    ('programs', 'created_by', 'delete'),
    ('workout_assignments', 'created_by', 'delete'),
    ('workout_notes', 'created_by', 'delete'),
    -- real shared records: refuse
    ('game_score_entries', 'logged_by', 'refuse'),
    ('groups', 'created_by', 'refuse'),
    ('organizations', 'owner_id', 'refuse'),
    ('revenue_split_transfers', 'coach_id', 'refuse'),
    ('team_games', 'created_by', 'refuse'),
    ('team_practice_schedules', 'created_by', 'refuse')
  ) as p(tbl, col, action)
$$;
revoke all on function public.profile_reference_policy() from public, anon, authenticated;
grant execute on function public.profile_reference_policy() to service_role;

-- ---- 3. the guardian-consent answer for a coach ----------------------------------------------------------------------------------------------------------
create or replace function public.guardian_consent_state(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.guardian_consents%rowtype;
begin
  if not (
    auth.role() = 'service_role'
    or (auth.uid() is not null and (
      auth.uid() = p_athlete
      or exists (
        select 1 from public.group_memberships a
        join public.groups g on g.id = a.group_id
        where a.profile_id = p_athlete and a.role = 'athlete' and a.membership_type = 'training' and g.archived_at is null and public.is_group_coach(a.group_id)
      )
    ))
  ) then
    return null;
  end if;
  -- a signature that stands wins; otherwise the latest request that was not replaced: waiting, run out of time ('expired'), or taken back
  select * into r from public.guardian_consents where athlete_id = p_athlete and status = 'signed' limit 1;
  if not found then
    select * into r from public.guardian_consents where athlete_id = p_athlete and status in ('pending', 'withdrawn') order by created_at desc limit 1;
  end if;
  if not found then
    return jsonb_build_object('state', 'none');
  end if;
  return jsonb_build_object(
    'state', case when r.status = 'signed' then 'signed' when r.status = 'withdrawn' then 'withdrawn' when r.expires_at > now() then 'pending' else 'expired' end,
    'guardian_email', r.guardian_email,
    'guardian_name', r.guardian_name,
    'relationship', r.relationship,
    'requested_at', r.created_at,
    'expires_at', r.expires_at,
    'signed_at', r.signed_at,
    'withdrawn_at', r.withdrawn_at
  );
end;
$$;
revoke execute on function public.guardian_consent_state(uuid) from public, anon;
grant execute on function public.guardian_consent_state(uuid) to authenticated, service_role;

-- ---- 4. the health-form flag goes when the last client seat goes -----------------------------------------------------------------------------------------
create or replace function public.clear_intake_flag_when_last_client_seat_goes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_role text := current_setting('request.jwt.claim.role', true);
begin
  begin
    if old.role = 'athlete' and not exists (select 1 from public.group_memberships m where m.profile_id = old.profile_id and m.role = 'athlete') then
      -- the sign-in-sensitive columns of profiles are guarded against a signed-in person's own writes; this write is the system's
      perform set_config('request.jwt.claim.role', 'service_role', true);
      update public.profiles set intake_required = false where id = old.profile_id and intake_required;
      perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);
    end if;
  exception when others then
    -- a problem here must never cost anyone their removal
    perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);
    raise warning 'clear_intake_flag_when_last_client_seat_goes: %', sqlerrm;
  end;
  return old;
end;
$$;
revoke execute on function public.clear_intake_flag_when_last_client_seat_goes() from public, anon, authenticated;
drop trigger if exists group_memberships_clear_intake on public.group_memberships;
create trigger group_memberships_clear_intake
  after delete on public.group_memberships
  for each row when (old.role = 'athlete')
  execute function public.clear_intake_flag_when_last_client_seat_goes();
