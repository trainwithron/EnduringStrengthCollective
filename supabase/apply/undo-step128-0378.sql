-- UNDO for step 128 (0378). Only if step 128 misbehaves. Puts back the earlier function that moves only sixteen tables. Records that were already moved stay moved.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
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
commit;
