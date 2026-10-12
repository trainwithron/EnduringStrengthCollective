-- STEP 92: 0346 A coach using the app as their own client can do everything a client can: nutrition phase plans, macro-target feedback and transformation cards no longer require the athlete role; 'Assign to Myself' attaches the program
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: A coach in 'My training' can keep nutrition phases for themselves, send feedback on their own macro target, make transformation cards, and assign a program to themselves (it becomes theirs, not a copy, when it qualifies). Nothing changes for clients. Run AFTER Release AW.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_phase_plans' and policyname = 'client_phase_plans_coach_manage' and position('''athlete''::member_role' in with_check) > 0))) then
    raise exception 'Step 92 (0346) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0346_coach_own_client_profile.sql
-- ====================================================================================================

-- Release AX: a coach using the app as their own client ("My training") can do everything a client can.
-- 1. Three rules required the person to be a member with the ATHLETE role, which a coach in their own group is not (a person has one role per group): nutrition phase plans, "this macro target doesn't work for me"
--    feedback, and transformation cards. They now only require membership in the group (the rest of each rule is unchanged, including the under-18 guard on cards).
-- 2. assign_program_to_client lets a coach assign a program to themselves in a group they coach ("Assign to Myself"): the program becomes theirs, with the same attach conditions as for any client.
-- Requires 0337 and 0345.
drop policy if exists "client_phase_plans_coach_manage" on public.client_phase_plans;
create policy "client_phase_plans_coach_manage" on public.client_phase_plans for all to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id) and exists (select 1 from public.group_memberships gm where gm.group_id = client_phase_plans.group_id and gm.profile_id = client_phase_plans.athlete_id));

drop policy if exists "client_nutrition_feedback_insert_client" on public.client_nutrition_feedback;
create policy "client_nutrition_feedback_insert_client" on public.client_nutrition_feedback for insert to authenticated
  with check (
    athlete_id = (select auth.uid())
    and status = 'new' and handled_by is null and handled_at is null
    and exists (select 1 from public.group_memberships gm where gm.group_id = client_nutrition_feedback.group_id and gm.profile_id = client_nutrition_feedback.athlete_id)
    and exists (select 1 from public.client_macro_target_history h where h.athlete_id = client_nutrition_feedback.athlete_id and h.group_id = client_nutrition_feedback.group_id and h.effective_from = client_nutrition_feedback.target_effective_from)
  );

drop policy if exists "transformation_cards_insert_own" on public.transformation_cards;
create policy "transformation_cards_insert_own" on public.transformation_cards for insert to authenticated
  with check (
    athlete_id = (select auth.uid())
    and exists (select 1 from public.group_memberships gm where gm.group_id = transformation_cards.group_id and gm.profile_id = (select auth.uid()))
    and (before_photo_id is null or exists (select 1 from public.progress_photos p where p.id = transformation_cards.before_photo_id and p.athlete_id = (select auth.uid())))
    and (after_photo_id is null or exists (select 1 from public.progress_photos p where p.id = transformation_cards.after_photo_id and p.athlete_id = (select auth.uid())))
    and (milestone_id is null or exists (select 1 from public.transformation_milestones m where m.id = transformation_cards.milestone_id and m.athlete_id = (select auth.uid())))
    and not exists (select 1 from public.client_intake ci where ci.athlete_id = (select auth.uid()) and ci.date_of_birth > ((current_date - '18 years'::interval))::date)
  );

drop policy if exists "transformation_cards_update_own" on public.transformation_cards;
create policy "transformation_cards_update_own" on public.transformation_cards for update to authenticated
  using (athlete_id = (select auth.uid()))
  with check (
    athlete_id = (select auth.uid())
    and exists (select 1 from public.group_memberships gm where gm.group_id = transformation_cards.group_id and gm.profile_id = (select auth.uid()))
    and (before_photo_id is null or exists (select 1 from public.progress_photos p where p.id = transformation_cards.before_photo_id and p.athlete_id = (select auth.uid())))
    and (after_photo_id is null or exists (select 1 from public.progress_photos p where p.id = transformation_cards.after_photo_id and p.athlete_id = (select auth.uid())))
    and (milestone_id is null or exists (select 1 from public.transformation_milestones m where m.id = transformation_cards.milestone_id and m.athlete_id = (select auth.uid())))
  );

create or replace function public.assign_program_to_client(
  p_program_id uuid,
  p_destination_group_id uuid,
  p_athlete_id uuid,
  p_client_name text default null,
  p_start_date date default null
)
returns table (assigned_program_id uuid, was_attached boolean)
language plpgsql
set search_path = public
as $$
declare
  src public.programs%rowtype;
  v_kind text;
  v_src_org uuid;
  v_dest_org uuid;
  v_new uuid;
begin
  if p_athlete_id is null then
    raise exception 'A client is required.';
  end if;
  -- The client must be an athlete in the group the program is going to (a loose id would otherwise get the program and the "assigned" notice). A coach may also assign to themselves in a group they coach.
  if not exists (select 1 from public.group_memberships gm where gm.group_id = p_destination_group_id and gm.profile_id = p_athlete_id and gm.role = 'athlete')
     and not (p_athlete_id = auth.uid() and public.is_group_coach(p_destination_group_id)) then
    raise exception 'That client is not in that group.';
  end if;

  select * into src from public.programs where id = p_program_id for update;
  if not found then
    raise exception 'Source program not found.';
  end if;
  select g.group_kind, g.organization_id into v_kind, v_src_org from public.groups g where g.id = src.group_id;
  select g.organization_id into v_dest_org from public.groups g where g.id = p_destination_group_id;

  if src.athlete_id is null
     and v_src_org is not distinct from v_dest_org
     and not src.ai_draft
     and src.archived_at is null
     and (v_kind = 'one_on_one' or src.is_active = false)
     and not exists (select 1 from public.workouts w join public.workout_logs l on l.workout_id = w.id where w.program_id = src.id)
     and not exists (select 1 from public.workouts w join public.athlete_sessions s on s.workout_id = w.id where w.program_id = src.id)
     and not exists (select 1 from public.workouts w join public.workout_assignments a on a.workout_id = w.id where w.program_id = src.id)
     and not exists (select 1 from public.challenges c where c.program_id = src.id)
     and not exists (select 1 from public.coach_packages cp where cp.default_program_id = src.id)
     and not exists (select 1 from public.workouts w join public.group_workout_exercises e on e.workout_id = w.id join public.athlete_exercise_overrides o on o.group_workout_exercise_id = e.id where w.program_id = src.id)
  then
    update public.programs
       set athlete_id = p_athlete_id,
           group_id = p_destination_group_id,
           is_active = true,
           start_date = coalesce(p_start_date, start_date)
     where id = src.id;
    update public.workouts set group_id = p_destination_group_id, athlete_id = p_athlete_id where program_id = src.id;
    update public.group_workout_exercises e set group_id = p_destination_group_id, athlete_id = p_athlete_id
      from public.workouts w where e.workout_id = w.id and w.program_id = src.id;
    update public.workout_notes n set group_id = p_destination_group_id, athlete_id = p_athlete_id
      from public.workouts w where n.workout_id = w.id and w.program_id = src.id;
    update public.exercise_progressions set group_id = p_destination_group_id where program_id = src.id;
    return query select src.id, true;
    return;
  end if;

  v_new := public.duplicate_program(p_program_id, p_destination_group_id, null, p_athlete_id, p_client_name, p_start_date);
  return query select v_new, false;
end;
$$;
revoke execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) to authenticated, service_role;

commit;
