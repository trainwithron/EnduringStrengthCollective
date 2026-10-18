-- UNDO for step 170 (0418). Only if step 170 misbehaves. Puts the two posts policies, the tag policy, the reference policy list and the guardian-consent answer back to what they were, and drops the new trigger and functions.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists group_memberships_clear_intake on public.group_memberships;
drop function if exists public.clear_intake_flag_when_last_client_seat_goes();
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
        where a.profile_id = p_athlete and a.role = 'athlete' and public.is_group_coach(a.group_id)
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
drop policy if exists "client_tag_assignments_select_org_member" on public.client_tag_assignments;
create policy "client_tag_assignments_select_org_member" on public.client_tag_assignments for select to authenticated using (exists (select 1 from public.client_tags t where t.id = client_tag_assignments.tag_id and (public.is_org_owner_or_admin(t.organization_id) or exists (select 1 from public.group_memberships c join public.group_memberships a on a.group_id = c.group_id where c.profile_id = (select auth.uid()) and c.role = 'coach' and a.profile_id = client_tag_assignments.athlete_id))));
drop function if exists public.athlete_private_from_org(uuid, uuid);
drop policy if exists "posts_select_members" on public.posts;
create policy "posts_select_members" on public.posts for select to authenticated using (public.is_group_member(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id)));
drop policy if exists "posts_delete_own_or_coach" on public.posts;
create policy "posts_delete_own_or_coach" on public.posts for delete to authenticated using (author_id = (select auth.uid()) or public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id)));
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
    ('client_goals', 'created_by', 'delete'),
    ('client_habits', 'created_by', 'delete'),
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
commit;
