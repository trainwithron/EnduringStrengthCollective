-- UNDO for step 92 (0346). Only if step 92 misbehaves. Puts back the three athlete-only rules and the assign function exactly as they were.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "client_phase_plans_coach_manage" on public.client_phase_plans;
create policy "client_phase_plans_coach_manage" on public.client_phase_plans for all to authenticated using (is_group_coach(group_id)) with check ((is_group_coach(group_id) AND (EXISTS ( SELECT 1 FROM group_memberships gm WHERE ((gm.group_id = client_phase_plans.group_id) AND (gm.profile_id = client_phase_plans.athlete_id) AND (gm.role = 'athlete'::member_role))))));
drop policy if exists "client_nutrition_feedback_insert_client" on public.client_nutrition_feedback;
create policy "client_nutrition_feedback_insert_client" on public.client_nutrition_feedback for insert to authenticated with check (((athlete_id = ( SELECT auth.uid() AS uid)) AND (status = 'new'::text) AND (handled_by IS NULL) AND (handled_at IS NULL) AND (EXISTS ( SELECT 1 FROM group_memberships gm WHERE ((gm.group_id = client_nutrition_feedback.group_id) AND (gm.profile_id = client_nutrition_feedback.athlete_id) AND (gm.role = 'athlete'::member_role)))) AND (EXISTS ( SELECT 1 FROM client_macro_target_history h WHERE ((h.athlete_id = client_nutrition_feedback.athlete_id) AND (h.group_id = client_nutrition_feedback.group_id) AND (h.effective_from = client_nutrition_feedback.target_effective_from))))));
drop policy if exists "transformation_cards_insert_own" on public.transformation_cards;
create policy "transformation_cards_insert_own" on public.transformation_cards for insert to authenticated with check (((athlete_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM group_memberships gm WHERE ((gm.group_id = transformation_cards.group_id) AND (gm.profile_id = ( SELECT auth.uid() AS uid)) AND (gm.role = 'athlete'::member_role)))) AND ((before_photo_id IS NULL) OR (EXISTS ( SELECT 1 FROM progress_photos p WHERE ((p.id = transformation_cards.before_photo_id) AND (p.athlete_id = ( SELECT auth.uid() AS uid)))))) AND ((after_photo_id IS NULL) OR (EXISTS ( SELECT 1 FROM progress_photos p WHERE ((p.id = transformation_cards.after_photo_id) AND (p.athlete_id = ( SELECT auth.uid() AS uid)))))) AND ((milestone_id IS NULL) OR (EXISTS ( SELECT 1 FROM transformation_milestones m WHERE ((m.id = transformation_cards.milestone_id) AND (m.athlete_id = ( SELECT auth.uid() AS uid)))))) AND (NOT (EXISTS ( SELECT 1 FROM client_intake ci WHERE ((ci.athlete_id = ( SELECT auth.uid() AS uid)) AND (ci.date_of_birth > ((CURRENT_DATE - '18 years'::interval))::date)))))));
drop policy if exists "transformation_cards_update_own" on public.transformation_cards;
create policy "transformation_cards_update_own" on public.transformation_cards for update to authenticated using ((athlete_id = ( SELECT auth.uid() AS uid))) with check (((athlete_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM group_memberships gm WHERE ((gm.group_id = transformation_cards.group_id) AND (gm.profile_id = ( SELECT auth.uid() AS uid)) AND (gm.role = 'athlete'::member_role)))) AND ((before_photo_id IS NULL) OR (EXISTS ( SELECT 1 FROM progress_photos p WHERE ((p.id = transformation_cards.before_photo_id) AND (p.athlete_id = ( SELECT auth.uid() AS uid)))))) AND ((after_photo_id IS NULL) OR (EXISTS ( SELECT 1 FROM progress_photos p WHERE ((p.id = transformation_cards.after_photo_id) AND (p.athlete_id = ( SELECT auth.uid() AS uid)))))) AND ((milestone_id IS NULL) OR (EXISTS ( SELECT 1 FROM transformation_milestones m WHERE ((m.id = transformation_cards.milestone_id) AND (m.athlete_id = ( SELECT auth.uid() AS uid))))))));
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
  -- The client must be an athlete in the group the program is going to (a loose id would otherwise get the program and the "assigned" notice).
  if not exists (select 1 from public.group_memberships gm where gm.group_id = p_destination_group_id and gm.profile_id = p_athlete_id and gm.role = 'athlete') then
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
