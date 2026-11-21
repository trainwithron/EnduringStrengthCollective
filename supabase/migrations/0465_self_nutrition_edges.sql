-- Step 221 (Ron, Nov 21: "I want to be able to assign meal plans to myself"). A coach's own nutrition lives in their PERSONAL SPACE (the group they made with no organization,
-- ensure_personal_space), where they are its coach and the athlete is themselves. Three places refused that one case because they look for an athlete membership; each now also allows
-- exactly it (the group is the person's own personal space, and the person is that same person), and nothing else changes. Re-running is safe.

-- 1. Turning off the automatic nutrition flags for oneself (client_nutrition_flags.auto_off): allowed for an athlete of the group as before, and now for the person themselves in
--    their own personal space. A coach is still never able to turn them off for anyone who is not an athlete of that group.
drop policy if exists "client_nutrition_flags_coach_all" on public.client_nutrition_flags;
create policy "client_nutrition_flags_coach_all" on public.client_nutrition_flags for all to authenticated
  using (public.is_group_coach(group_id))
  with check (
    public.is_group_coach(group_id)
    and (
      auto_off = false
      or exists (select 1 from public.group_memberships gm where gm.group_id = client_nutrition_flags.group_id and gm.profile_id = client_nutrition_flags.profile_id and gm.role = 'athlete')
      or (
        client_nutrition_flags.profile_id = (select auth.uid())
        and exists (select 1 from public.groups g where g.id = client_nutrition_flags.group_id and g.created_by = (select auth.uid()) and g.organization_id is null)
      )
    )
  );

-- 2 and 3. Asking for a different meal plan (apply_meal_plan_try) and the allergy rebuild (apply_allergy_rebuild): the person must be an athlete of the group, or this is their own
-- personal space (made by them, no organization). In a personal space the coach told about it is that same person, so nobody is told about their own request.
-- Patched into the LIVE functions: each piece must be found exactly once, or nothing changes. Already patched: skipped.
create or replace function pg_temp.patch_once_221(p_name text, p_def text, p_old text, p_new text) returns text language plpgsql as $f$
declare
  v_count int := (length(p_def) - length(replace(p_def, p_old, ''))) / greatest(length(p_old), 1);
begin
  if v_count <> 1 then
    raise exception '%: expected this exactly once, found % times. NOTHING was changed: %', p_name, v_count, left(p_old, 80);
  end if;
  return replace(p_def, p_old, p_new);
end;
$f$;

do $patch$
declare
  v_name text;
  v_sig regprocedure;
  v_def text;
begin
  foreach v_name in array array['apply_meal_plan_try', 'apply_allergy_rebuild'] loop
    v_sig := case v_name
      when 'apply_meal_plan_try' then 'public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text)'::regprocedure
      else 'public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)'::regprocedure
    end;
    v_def := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
    if position('g.created_by = p_athlete_id and g.organization_id is null' in v_def) > 0 then
      continue;
    end if;
    v_def := pg_temp.patch_once_221(v_name, v_def,
      E'  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = ''athlete'') then\n    raise exception ''not_a_client'';',
      E'  -- an athlete of the group, or the person themselves in their own personal space (step 221)\n  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = ''athlete'')\n     and not exists (select 1 from public.groups g where g.id = p_group_id and g.created_by = p_athlete_id and g.organization_id is null) then\n    raise exception ''not_a_client'';');
    v_def := pg_temp.patch_once_221(v_name, v_def,
      E'  for r in select profile_id from public.group_memberships where group_id = p_group_id and role = ''coach'' loop',
      E'  for r in select profile_id from public.group_memberships where group_id = p_group_id and role = ''coach'' and profile_id <> p_athlete_id loop');
    execute v_def;
  end loop;
end
$patch$;
