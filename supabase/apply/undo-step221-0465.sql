-- UNDO: step 221. Only if it must be taken back: puts the flags rule and the two functions back exactly as they were. Last result: one row, all true.

begin;

drop policy if exists "client_nutrition_flags_coach_all" on public.client_nutrition_flags;
create policy "client_nutrition_flags_coach_all" on public.client_nutrition_flags for all
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id) and (auto_off = false or exists (select 1 from public.group_memberships gm where gm.group_id = client_nutrition_flags.group_id and gm.profile_id = client_nutrition_flags.profile_id and gm.role = 'athlete')));

do $unpatch$
declare
  v_sig regprocedure;
  v_def text;
begin
  foreach v_sig in array array['public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text)'::regprocedure, 'public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)'::regprocedure] loop
    v_def := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
    if position('g.created_by = p_athlete_id and g.organization_id is null' in v_def) = 0 then
      continue;
    end if;
    v_def := replace(v_def,
      E'  -- an athlete of the group, or the person themselves in their own personal space (step 221)\n  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = ''athlete'')\n     and not exists (select 1 from public.groups g where g.id = p_group_id and g.created_by = p_athlete_id and g.organization_id is null) then\n    raise exception ''not_a_client'';',
      E'  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = ''athlete'') then\n    raise exception ''not_a_client'';');
    v_def := replace(v_def,
      E'  for r in select profile_id from public.group_memberships where group_id = p_group_id and role = ''coach'' and profile_id <> p_athlete_id loop',
      E'  for r in select profile_id from public.group_memberships where group_id = p_group_id and role = ''coach'' loop');
    execute v_def;
  end loop;
end
$unpatch$;

commit;

-- Check: one row, all true.
select
  position('organization_id IS NULL' in (select pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.client_nutrition_flags'::regclass and polname = 'client_nutrition_flags_coach_all')) = 0 as flags_rule_as_before,
  position('g.created_by = p_athlete_id' in (select prosrc from pg_proc where oid = 'public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text)'::regprocedure)) = 0 as plan_try_as_before,
  position('g.created_by = p_athlete_id' in (select prosrc from pg_proc where oid = 'public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)'::regprocedure)) = 0 as allergy_rebuild_as_before;
