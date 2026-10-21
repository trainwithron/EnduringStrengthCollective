-- UNDO for step 182 (0430). Only if step 182 misbehaves, and only while the allergy rebuild app update is NOT live (it calls apply_allergy_rebuild). The function goes and restore_meal_plan_try is put back exactly as before. The source column and the widened check stay (rows already written as allergy rebuilds stay as records).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text);
create or replace function public.restore_meal_plan_try(p_try_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t public.meal_plan_tries%rowtype;
  v_restored int := 0;
  d date;
  snap jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_allowed';
  end if;
  select * into t from public.meal_plan_tries where id = p_try_id;
  if not found then
    raise exception 'not_found';
  end if;
  if not public.is_group_coach(t.group_id) then
    raise exception 'not_allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('meal_plan_try:' || t.athlete_id::text, 0));

  select * into t from public.meal_plan_tries where id = p_try_id for update;
  if t.restored_at is not null then
    raise exception 'already_restored';
  end if;
  -- One step back at a time: only the latest try that has not been put back.
  if exists (
    select 1 from public.meal_plan_tries o
    where o.athlete_id = t.athlete_id and o.restored_at is null and o.id <> t.id and (o.requested_at, o.id) > (t.requested_at, t.id)
  ) then
    raise exception 'not_latest';
  end if;

  foreach d in array t.dates loop
    -- Only a day still as this try left it; a day changed by hand since is left alone.
    if not exists (
      select 1 from public.meal_plans mp where mp.athlete_id = t.athlete_id and mp.log_date = d and public.meal_plan_try_number(mp.rationale) = t.try_number
    ) then
      continue;
    end if;
    select s into snap from jsonb_array_elements(t.previous_plan) s where (s ->> 'log_date')::date = d limit 1;
    if snap is null then
      delete from public.meal_plans where athlete_id = t.athlete_id and log_date = d;
    else
      update public.meal_plans mp
        set archetype = (snap ->> 'archetype'), meal_count = (snap ->> 'meal_count')::int, include_snack = (snap ->> 'include_snack')::boolean,
            carb_cycling = (snap ->> 'carb_cycling')::boolean, rationale = (snap ->> 'rationale'), macros = (snap -> 'macros'), meals = (snap -> 'meals'),
            created_by = (snap ->> 'created_by')::uuid
        where mp.athlete_id = t.athlete_id and mp.log_date = d;
    end if;
    v_restored := v_restored + 1;
  end loop;

  update public.meal_plan_tries set restored_at = now(), restored_by = auth.uid() where id = t.id;
  return v_restored;
end;
$function$;
revoke all on function public.restore_meal_plan_try(uuid) from public, anon;
grant execute on function public.restore_meal_plan_try(uuid) to authenticated;
commit;
