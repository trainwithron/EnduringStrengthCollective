-- Release AR: tenant safety. One rule, in the database, for every table where a coach writes a row about a person: THE PERSON MUST BELONG TO THE GROUP THE ROW IS FILED UNDER.
-- Before, each coach write policy only checked "the caller coaches the group named on the row", so any coach (sign-up is open) could file rows about ANY user id: forged parental consent, macro targets and meal
-- plans that lock out the real coach, bookings, programs, workout assignments, video check-ins, and fake sessions that score a person's records and raise their training maxes.
--   1. public.enforce_athlete_in_group(): a before-insert/update trigger on 28 tables. For a signed-in user (not the server, not a database job), the row's person must be a member (any role, so a coach's own
--      rows still work) of the row's group. On update it only checks when the person or the group is being changed, so editing an old row of someone who has since left still works.
--   2. move_client_to_group: both groups must be in the same organization, and the person must be a client of the source group.
--   3. A membership can't be moved to a group of another organization by editing it directly (trigger).
--   4. An organization admin can no longer add themselves as a coach to a one-on-one space or to a group that holds a client who is private from the organization.
--   5. A comment can only be saved in the group of the post it belongs to.
-- Nothing is deleted or rewritten. The live database has no existing row that breaks rule 1 except two old ones (a finished session and a wellness check-in of people who have since left a group), which stay as they are.

create or replace function public.enforce_athlete_in_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete uuid := nullif(to_jsonb(new)->>'athlete_id', '')::uuid;
  v_group uuid := nullif(to_jsonb(new)->>'group_id', '')::uuid;
begin
  -- Only a signed-in person's own request is checked. The server (service role), definer jobs run by the database and migrations are not.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if v_athlete is null or v_group is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and v_athlete is not distinct from nullif(to_jsonb(old)->>'athlete_id', '')::uuid
     and v_group is not distinct from nullif(to_jsonb(old)->>'group_id', '')::uuid then
    return new;
  end if;
  if not exists (select 1 from public.group_memberships gm where gm.group_id = v_group and gm.profile_id = v_athlete) then
    raise exception 'That person is not a member of this group.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_athlete_in_group() from public, anon, authenticated;

drop trigger if exists minor_consent_enforce_athlete_in_group on public.minor_consent;
create trigger minor_consent_enforce_athlete_in_group before insert or update on public.minor_consent for each row execute function public.enforce_athlete_in_group();
drop trigger if exists daily_macros_enforce_athlete_in_group on public.daily_macros;
create trigger daily_macros_enforce_athlete_in_group before insert or update on public.daily_macros for each row execute function public.enforce_athlete_in_group();
drop trigger if exists meal_plans_enforce_athlete_in_group on public.meal_plans;
create trigger meal_plans_enforce_athlete_in_group before insert or update on public.meal_plans for each row execute function public.enforce_athlete_in_group();
drop trigger if exists athlete_injury_status_enforce_athlete_in_group on public.athlete_injury_status;
create trigger athlete_injury_status_enforce_athlete_in_group before insert or update on public.athlete_injury_status for each row execute function public.enforce_athlete_in_group();
drop trigger if exists athlete_sessions_enforce_athlete_in_group on public.athlete_sessions;
create trigger athlete_sessions_enforce_athlete_in_group before insert or update on public.athlete_sessions for each row execute function public.enforce_athlete_in_group();
drop trigger if exists bookings_enforce_athlete_in_group on public.bookings;
create trigger bookings_enforce_athlete_in_group before insert or update on public.bookings for each row execute function public.enforce_athlete_in_group();
drop trigger if exists programs_enforce_athlete_in_group on public.programs;
create trigger programs_enforce_athlete_in_group before insert or update on public.programs for each row execute function public.enforce_athlete_in_group();
drop trigger if exists workout_assignments_enforce_athlete_in_group on public.workout_assignments;
create trigger workout_assignments_enforce_athlete_in_group before insert or update on public.workout_assignments for each row execute function public.enforce_athlete_in_group();
drop trigger if exists coach_video_checkins_enforce_athlete_in_group on public.coach_video_checkins;
create trigger coach_video_checkins_enforce_athlete_in_group before insert or update on public.coach_video_checkins for each row execute function public.enforce_athlete_in_group();
drop trigger if exists nutrition_checkins_enforce_athlete_in_group on public.nutrition_checkins;
create trigger nutrition_checkins_enforce_athlete_in_group before insert or update on public.nutrition_checkins for each row execute function public.enforce_athlete_in_group();
drop trigger if exists nutrition_phases_enforce_athlete_in_group on public.nutrition_phases;
create trigger nutrition_phases_enforce_athlete_in_group before insert or update on public.nutrition_phases for each row execute function public.enforce_athlete_in_group();
drop trigger if exists client_habits_enforce_athlete_in_group on public.client_habits;
create trigger client_habits_enforce_athlete_in_group before insert or update on public.client_habits for each row execute function public.enforce_athlete_in_group();
drop trigger if exists session_credits_enforce_athlete_in_group on public.session_credits;
create trigger session_credits_enforce_athlete_in_group before insert or update on public.session_credits for each row execute function public.enforce_athlete_in_group();
drop trigger if exists wellness_checkins_enforce_athlete_in_group on public.wellness_checkins;
create trigger wellness_checkins_enforce_athlete_in_group before insert or update on public.wellness_checkins for each row execute function public.enforce_athlete_in_group();
drop trigger if exists kiosk_checkins_enforce_athlete_in_group on public.kiosk_checkins;
create trigger kiosk_checkins_enforce_athlete_in_group before insert or update on public.kiosk_checkins for each row execute function public.enforce_athlete_in_group();
drop trigger if exists athlete_exercise_overrides_enforce_athlete_in_group on public.athlete_exercise_overrides;
create trigger athlete_exercise_overrides_enforce_athlete_in_group before insert or update on public.athlete_exercise_overrides for each row execute function public.enforce_athlete_in_group();
drop trigger if exists body_weight_logs_enforce_athlete_in_group on public.body_weight_logs;
create trigger body_weight_logs_enforce_athlete_in_group before insert or update on public.body_weight_logs for each row execute function public.enforce_athlete_in_group();
drop trigger if exists nutrition_checkin_suggestions_enforce_athlete_in_group on public.nutrition_checkin_suggestions;
create trigger nutrition_checkin_suggestions_enforce_athlete_in_group before insert or update on public.nutrition_checkin_suggestions for each row execute function public.enforce_athlete_in_group();
drop trigger if exists client_goals_enforce_athlete_in_group on public.client_goals;
create trigger client_goals_enforce_athlete_in_group before insert or update on public.client_goals for each row execute function public.enforce_athlete_in_group();
drop trigger if exists client_macro_targets_enforce_athlete_in_group on public.client_macro_targets;
create trigger client_macro_targets_enforce_athlete_in_group before insert or update on public.client_macro_targets for each row execute function public.enforce_athlete_in_group();
drop trigger if exists client_phase_plans_enforce_athlete_in_group on public.client_phase_plans;
create trigger client_phase_plans_enforce_athlete_in_group before insert or update on public.client_phase_plans for each row execute function public.enforce_athlete_in_group();
drop trigger if exists session_exercise_videos_enforce_athlete_in_group on public.session_exercise_videos;
create trigger session_exercise_videos_enforce_athlete_in_group before insert or update on public.session_exercise_videos for each row execute function public.enforce_athlete_in_group();
drop trigger if exists transformation_milestones_enforce_athlete_in_group on public.transformation_milestones;
create trigger transformation_milestones_enforce_athlete_in_group before insert or update on public.transformation_milestones for each row execute function public.enforce_athlete_in_group();
drop trigger if exists workout_notes_enforce_athlete_in_group on public.workout_notes;
create trigger workout_notes_enforce_athlete_in_group before insert or update on public.workout_notes for each row execute function public.enforce_athlete_in_group();
drop trigger if exists workouts_enforce_athlete_in_group on public.workouts;
create trigger workouts_enforce_athlete_in_group before insert or update on public.workouts for each row execute function public.enforce_athlete_in_group();
drop trigger if exists group_workout_exercises_enforce_athlete_in_group on public.group_workout_exercises;
create trigger group_workout_exercises_enforce_athlete_in_group before insert or update on public.group_workout_exercises for each row execute function public.enforce_athlete_in_group();
drop trigger if exists booking_waitlist_entries_enforce_athlete_in_group on public.booking_waitlist_entries;
create trigger booking_waitlist_entries_enforce_athlete_in_group before insert or update on public.booking_waitlist_entries for each row execute function public.enforce_athlete_in_group();
drop trigger if exists game_score_entries_enforce_athlete_in_group on public.game_score_entries;
create trigger game_score_entries_enforce_athlete_in_group before insert or update on public.game_score_entries for each row execute function public.enforce_athlete_in_group();

-- 2. move_client_to_group: same organization, and a real client of the source group.
create or replace function public.move_client_to_group(p_athlete_id uuid, p_from_group_id uuid, p_to_group_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_group_coach(p_from_group_id) or not public.is_group_coach(p_to_group_id) then
    raise exception 'Must coach both the source and destination group.';
  end if;

  -- Both groups must be in the same organization (a coach who belongs to two organizations must not be able to carry a client, and their records, across the line between them),
  -- and the person moved must be a client of the source group (not a co-coach or an owner).
  if (select g.organization_id from public.groups g where g.id = p_from_group_id) is distinct from (select g.organization_id from public.groups g where g.id = p_to_group_id) then
    raise exception 'A client can only be moved between groups of the same organization.';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = p_from_group_id and profile_id = p_athlete_id and role = 'athlete') then
    raise exception 'That person is not a client in the source group.';
  end if;

  -- A one-on-one space holds ONE client: say so plainly instead of failing later on a database rule.
  if public.is_one_on_one_group(p_to_group_id)
     and exists (select 1 from public.group_memberships where group_id = p_to_group_id and role = 'athlete' and profile_id <> p_athlete_id) then
    raise exception 'A one-on-one space holds one client, and this one already has theirs.';
  end if;

  if exists (
    select 1 from public.group_memberships
    where group_id = p_to_group_id and profile_id = p_athlete_id
  ) then
    raise exception 'This client is already a member of the destination group.';
  end if;

  update public.group_memberships set group_id = p_to_group_id
    where group_id = p_from_group_id and profile_id = p_athlete_id;

  update public.workout_logs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.session_credits set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.body_weight_logs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_notes set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.client_habits set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.daily_macros set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workout_assignments set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.bookings set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_sessions set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.meal_plans set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_exercise_overrides set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.credit_purchases set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.subscription_credit_grants set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.membership_subscriptions set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;

  update public.programs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workouts set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.group_workout_exercises set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workout_notes set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;

  delete from public.package_assignments
    where athlete_id = p_athlete_id
      and coach_package_id in (select id from public.coach_packages where group_id = p_from_group_id);
end;
$function$;

-- 3. A membership cannot be moved to a group of another organization by editing it directly.
create or replace function public.guard_membership_org_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and new.group_id is distinct from old.group_id
     and (select g.organization_id from public.groups g where g.id = old.group_id) is distinct from (select g.organization_id from public.groups g where g.id = new.group_id) then
    raise exception 'A member can only be moved between groups of the same organization.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_membership_org_move() from public, anon, authenticated;
drop trigger if exists group_memberships_guard_org_move on public.group_memberships;
create trigger group_memberships_guard_org_move before update on public.group_memberships for each row execute function public.guard_membership_org_move();

-- 4. An organization admin cannot add themselves as coach of a one-on-one space, or of a group with a client who is private from the organization.
create or replace function public.group_closed_to_org_admin_join(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Answers only for an organization admin of that group (the one place a policy asks), so it can not be used to look up other groups.
  select public.is_org_admin_of_group(p_group_id)
    and (
      exists (select 1 from public.groups g where g.id = p_group_id and g.group_kind = 'one_on_one')
      or exists (select 1 from public.group_memberships gm where gm.group_id = p_group_id and gm.role = 'athlete' and gm.private_from_org = true)
    );
$$;
revoke execute on function public.group_closed_to_org_admin_join(uuid) from public, anon;
grant execute on function public.group_closed_to_org_admin_join(uuid) to authenticated, service_role;

drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert
  to authenticated with check (
    (public.is_group_coach(group_id) and (profile_id = (select auth.uid()) or public.is_coach_of_athlete(profile_id)))
    or (
      profile_id = (select auth.uid())
      and role = 'coach'
      and public.is_org_admin_of_group(group_id)
      and not public.group_closed_to_org_admin_join(group_id)
    )
  );

-- 5. A comment is saved in the group of its post.
drop policy if exists "comments_insert_members" on public.comments;
create policy "comments_insert_members" on public.comments for insert
  to authenticated with check (
    author_id = (select auth.uid())
    and public.is_group_member(group_id)
    and exists (select 1 from public.posts p where p.id = comments.post_id and p.group_id = comments.group_id)
  );
drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own" on public.comments for update
  to authenticated using (author_id = (select auth.uid()))
  with check (
    author_id = (select auth.uid())
    and public.is_group_member(group_id)
    and exists (select 1 from public.posts p where p.id = comments.post_id and p.group_id = comments.group_id)
  );
