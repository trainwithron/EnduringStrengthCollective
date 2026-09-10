-- Moves one athlete's membership AND all their group-scoped data
-- (credits, logged history, notes, habits, macros, bookings, personal
-- programs, etc.) from one group to another, atomically. Without this,
-- reassigning a client's group_memberships row alone would silently
-- orphan their history — a client's data is scattered across ~15 tables
-- keyed by (athlete_id, group_id), not just the membership row.
--
-- SECURITY DEFINER, so it does its own authorization check up front
-- (must coach both the source and destination group) rather than relying
-- on each individual table's own RLS, which would otherwise require the
-- caller to already coach a destination group they may have just created
-- in the same request.
--
-- Deliberately NOT moved: shared group programs (athlete_id is null —
-- they belong to the group's whole roster, not this one athlete), and
-- feed posts/comments/reactions/notifications (historical artifact of
-- the old group's community, not really "this athlete's data" to carry
-- forward). package_assignments referencing the old group's packages are
-- cleared rather than moved, since a package is fundamentally scoped to
-- one coach_packages row tied to the old group.
create or replace function public.move_client_to_group(
  p_athlete_id uuid,
  p_from_group_id uuid,
  p_to_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_coach(p_from_group_id) or not public.is_group_coach(p_to_group_id) then
    raise exception 'Must coach both the source and destination group.';
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

  -- Personal (1-on-1) programs only — a shared group program (athlete_id
  -- null) stays with the group's whole roster, never this one athlete.
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
$$;

grant execute on function public.move_client_to_group(uuid, uuid, uuid) to authenticated;
