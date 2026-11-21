-- The LIVE apply_allergy_rebuild (md5 of its body 5f50784e10a6286842f4a088a1cdd7d2) and apply_meal_plan_try (c6a9e52c6fc991153682bd1ed5be003f) as they were on Nov 21. Their lines end in CR LF live: the rehearsal puts them back after git.
CREATE OR REPLACE FUNCTION public.apply_allergy_rebuild(p_athlete_id uuid, p_group_id uuid, p_today date, p_rows jsonb, p_notice text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dates date[];
  v_snapshot jsonb;
  v_count int;
  r record;
begin
  if p_athlete_id is null or p_group_id is null or p_today is null or coalesce(btrim(p_notice), '') = '' then
    raise exception 'bad_request';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete') then
    raise exception 'not_a_client';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 31 then
    raise exception 'bad_rows';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('meal_plan_try:' || p_athlete_id::text, 0));

  select array_agg(x.log_date order by x.log_date) into v_dates
  from jsonb_to_recordset(p_rows) as x(log_date date, meals jsonb);
  if v_dates is null or cardinality(v_dates) <> jsonb_array_length(p_rows) or cardinality(v_dates) <> (select count(distinct d) from unnest(v_dates) d) then
    raise exception 'bad_rows';
  end if;
  if exists (select 1 from unnest(v_dates) d where d is null or d < p_today or d > p_today + 60) then
    raise exception 'bad_dates';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(meals jsonb) where x.meals is null or jsonb_typeof(x.meals) <> 'object') then
    raise exception 'bad_rows';
  end if;
  -- Only days the client already has in this group: this changes the meals of an assigned day, it never creates one.
  if (select count(*) from public.meal_plans mp where mp.athlete_id = p_athlete_id and mp.group_id = p_group_id and mp.log_date = any (v_dates)) <> cardinality(v_dates) then
    raise exception 'bad_dates';
  end if;

  select coalesce(jsonb_agg(to_jsonb(mp) order by mp.log_date), '[]'::jsonb) into v_snapshot
  from public.meal_plans mp
  where mp.athlete_id = p_athlete_id and mp.log_date = any (v_dates);

  insert into public.meal_plan_tries (athlete_id, group_id, try_number, source, note, summary, dates, previous_plan)
  values (p_athlete_id, p_group_id, 0, 'allergy', '', left(p_notice, 300), v_dates, v_snapshot);

  update public.meal_plans mp
    set meals = x.meals
    from jsonb_to_recordset(p_rows) as x(log_date date, meals jsonb)
    where mp.athlete_id = p_athlete_id and mp.group_id = p_group_id and mp.log_date = x.log_date;
  get diagnostics v_count = row_count;

  for r in select profile_id from public.group_memberships where group_id = p_group_id and role = 'coach' loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.profile_id, p_group_id, 'meal_plan_try', left(p_notice, 300), '/groups/' || p_group_id::text || '/nutrition?athleteId=' || p_athlete_id::text);
  end loop;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_meal_plan_try(p_athlete_id uuid, p_group_id uuid, p_today date, p_rows jsonb, p_note text, p_summary text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_used int;
  v_n int;
  v_dates date[];
  v_snapshot jsonb;
  v_name text;
  v_count int;
  r record;
begin
  if p_athlete_id is null or p_group_id is null or p_today is null then
    raise exception 'bad_request';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete') then
    raise exception 'not_a_client';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 31 then
    raise exception 'bad_rows';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('meal_plan_try:' || p_athlete_id::text, 0));

  select coalesce(max(public.meal_plan_try_number(rationale)), 0) into v_used
  from public.meal_plans
  where athlete_id = p_athlete_id and log_date >= p_today;
  if v_used >= 3 then
    raise exception 'no_tries_left';
  end if;
  v_n := v_used + 1;

  select array_agg(x.log_date order by x.log_date) into v_dates
  from jsonb_to_recordset(p_rows) as x(log_date date);
  if v_dates is null or cardinality(v_dates) <> jsonb_array_length(p_rows) or cardinality(v_dates) <> (select count(distinct d) from unnest(v_dates) d) then
    raise exception 'bad_rows';
  end if;
  if exists (select 1 from unnest(v_dates) d where d is null or d < p_today or d > p_today + 60) then
    raise exception 'bad_dates';
  end if;
  -- Only days the library built (or an earlier try rebuilt) may be replaced; a day the coach built by hand is never touched.
  if exists (
    select 1 from public.meal_plans mp
    where mp.athlete_id = p_athlete_id and mp.log_date = any (v_dates)
      and mp.rationale is distinct from 'Built from the recipe library for the week.'
      and public.meal_plan_try_number(mp.rationale) is null
  ) then
    raise exception 'hand_built';
  end if;
  -- The rows must name a coach of this group as the plan's author (the rebuilt plan is still the coach's plan).
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(created_by uuid)
    where x.created_by is null or not exists (select 1 from public.group_memberships gm where gm.group_id = p_group_id and gm.profile_id = x.created_by and gm.role = 'coach')
  ) then
    raise exception 'bad_rows';
  end if;

  select coalesce(jsonb_agg(to_jsonb(mp) order by mp.log_date), '[]'::jsonb) into v_snapshot
  from public.meal_plans mp
  where mp.athlete_id = p_athlete_id and mp.log_date = any (v_dates);

  insert into public.meal_plan_tries (athlete_id, group_id, try_number, note, summary, dates, previous_plan)
  values (p_athlete_id, p_group_id, v_n, left(coalesce(p_note, ''), 300), left(coalesce(p_summary, ''), 300), v_dates, v_snapshot);

  insert into public.meal_plans (athlete_id, group_id, log_date, archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals, created_by)
  select p_athlete_id, p_group_id, x.log_date, x.archetype, x.meal_count, coalesce(x.include_snack, false), coalesce(x.carb_cycling, false),
         'Rebuilt at the client''s request (try ' || v_n::text || ' of 3).', x.macros, x.meals, x.created_by
  from jsonb_to_recordset(p_rows) as x(log_date date, archetype text, meal_count int, include_snack boolean, carb_cycling boolean, macros jsonb, meals jsonb, created_by uuid)
  on conflict (athlete_id, log_date) do update
    set archetype = excluded.archetype, meal_count = excluded.meal_count, include_snack = excluded.include_snack, carb_cycling = excluded.carb_cycling,
        rationale = excluded.rationale, macros = excluded.macros, meals = excluded.meals, created_by = excluded.created_by;

  select coalesce(nullif(btrim(full_name), ''), 'Your client') into v_name from public.profiles where id = p_athlete_id;
  for r in select profile_id from public.group_memberships where group_id = p_group_id and role = 'coach' loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.profile_id, p_group_id, 'meal_plan_try', v_name || ' asked for a different meal plan (try ' || v_n::text || ' of 3).',
            '/groups/' || p_group_id::text || '/nutrition?athleteId=' || p_athlete_id::text);
  end loop;
  v_count := v_n;
  return v_count;
end;
$function$
;
