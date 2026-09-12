-- Real security bug found during a QA pass on the Home calendar
-- redesign: program visibility_window / content-dripping (lib/program-
-- schedule.ts's isLocked) was only ever enforced in application code —
-- the RLS policies on workouts, group_workout_exercises, and
-- group_workout_exercise_sets never had any date condition at all.
-- Verified live before this fix: an athlete on a 'day'-window program
-- could read a future locked workout's exercise names and set data
-- directly via PostgREST, weeks ahead of when the UI would ever show
-- it to them. The Home redesign's new Month view makes this more
-- discoverable (it surfaces future days by design), so this needed
-- fixing alongside it, not left for later.
--
-- This computes the exact same schedule math as
-- computeScheduledDates()/isLocked() in lib/program-schedule.ts —
-- walk forward from the program's start_date counting training-day
-- matches until reaching this workout's ordinal position in the
-- program's own (week_number, day_index) order, then compare against
-- today + the visibility window's day count. A program with no
-- start_date/training_days set, or a 'full' visibility window, is
-- never locked, matching the TS implementation exactly.
--
-- Known, accepted imprecision: this uses current_date (the database
-- server's own UTC clock), not the group coach's real timezone the
-- application layer resolves via lib/timezone.ts's nowInZone(). That
-- can disagree by up to a day right at a timezone's midnight boundary.
-- This function is a defense-in-depth backstop, not the primary pacing
-- UX (which stays the precise, timezone-aware application-code check) —
-- going from zero enforcement to same-day-ish enforcement is the real
-- fix here; exact-to-the-hour parity with the UI isn't the goal.
--
-- Coaches (is_group_coach) and org-admin/platform-admin oversight
-- access are both left completely unpaced, same as today — this is
-- specifically an athlete-facing pacing gate, not a coach or admin
-- restriction.
create or replace function public.is_workout_visible_to_athlete(target_workout_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_program_id uuid;
  v_week_number int;
  v_day_index int;
  v_start_date date;
  v_training_days smallint[];
  v_visibility_window text;
  v_ordinal int;
  v_cursor date;
  v_matched int := 0;
  v_scheduled_date date;
  v_window_days int;
begin
  select w.program_id, w.week_number, w.day_index
  into v_program_id, v_week_number, v_day_index
  from public.workouts w where w.id = target_workout_id;

  if v_program_id is null then
    return true;
  end if;

  select p.start_date, p.training_days, coalesce(p.visibility_window, 'day')
  into v_start_date, v_training_days, v_visibility_window
  from public.programs p where p.id = v_program_id;

  if v_start_date is null or v_training_days is null or array_length(v_training_days, 1) is null then
    return true;
  end if;

  if v_visibility_window = 'full' then
    return true;
  end if;

  select count(*) into v_ordinal
  from public.workouts w2
  where w2.program_id = v_program_id
    and (w2.week_number, w2.day_index) <= (v_week_number, v_day_index);

  v_cursor := v_start_date;
  while v_matched < v_ordinal loop
    if extract(dow from v_cursor)::int = any(v_training_days) then
      v_matched := v_matched + 1;
      exit when v_matched = v_ordinal;
    end if;
    v_cursor := v_cursor + 1;
  end loop;
  v_scheduled_date := v_cursor;

  v_window_days := case v_visibility_window
    when 'week' then 7
    when 'month' then 30
    else 0
  end;

  return v_scheduled_date <= (current_date + v_window_days);
end;
$$;

drop policy "workouts_select_members" on public.workouts;
create policy "workouts_select_members" on public.workouts for select
  to authenticated using (
    is_group_member(group_id)
    and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id))
    and (is_group_coach(group_id) or public.is_workout_visible_to_athlete(id))
  );

drop policy "gwe_select_members" on public.group_workout_exercises;
create policy "gwe_select_members" on public.group_workout_exercises for select
  to authenticated using (
    (
      is_group_member(group_id)
      and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id))
      and (is_group_coach(group_id) or public.is_workout_visible_to_athlete(workout_id))
    )
    or (
      (is_org_admin_of_group(group_id) or is_platform_admin())
      and (athlete_id is null or not is_client_private_from_org(group_id, athlete_id))
    )
  );

drop policy "gwes_select_members" on public.group_workout_exercise_sets;
create policy "gwes_select_members" on public.group_workout_exercise_sets for select
  to authenticated using (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_sets.group_workout_exercise_id
        and (
          (
            is_group_member(g.group_id)
            and (g.athlete_id is null or g.athlete_id = (select auth.uid()) or is_group_coach(g.group_id))
            and (is_group_coach(g.group_id) or public.is_workout_visible_to_athlete(g.workout_id))
          )
          or (
            (is_org_admin_of_group(g.group_id) or is_platform_admin())
            and (g.athlete_id is null or not is_client_private_from_org(g.group_id, g.athlete_id))
          )
        )
    )
  );
