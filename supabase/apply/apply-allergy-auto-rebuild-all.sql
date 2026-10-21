-- ALLERGY AUTO-REBUILD (A CLIENT'S NEW ALLERGY SWAPS THE CLASHING OPTIONS OF THEIR PLAN AUTOMATICALLY: ONE COLUMN, ONE FUNCTION ADDED, ONE REPLACED): ONE paste. Steps 182 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 182: Nothing changes until the app update that goes with it is deployed. Then a client who opens Nutrition with no food answers is asked once about allergies and foods they avoid, and when they save one that clashes with their assigned plan, the clashing options are swapped (library first, AI only for a meal left empty) and the coach gets a notice: "<Name>'s peanut allergy clashed with their meal plan: 3 days rebuilt automatically."
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Allergy auto-rebuild (a client's new allergy swaps the clashing options of their plan automatically: one column, one function added, one replaced), step 182: 0430 Allergy auto-rebuild: when a client adds an allergy or a food they avoid, the options of their plan that now break it are swapped automatically, with a copy kept and the coach told (one column, one function added, one replaced)
do $g182$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0430 is not already applied (apply_allergy_rebuild is not there yet)', to_regprocedure('public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)') is null),
      ('restore_meal_plan_try is exactly the text this replaces', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '8046c690a08a1943b1b7fec489243744' from pg_proc p where p.oid = to_regprocedure('public.restore_meal_plan_try(uuid)')), false)),
      ('the table and functions it uses exist', to_regclass('public.meal_plan_tries') is not null and to_regclass('public.meal_plans') is not null and to_regprocedure('public.meal_plan_try_number(text)') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null),
      ('the meal_plan_try notice type is allowed', exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass and position('''meal_plan_try''' in pg_get_constraintdef(oid)) > 0))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Allergy auto-rebuild (a client''s new allergy swaps the clashing options of their plan automatically: one column, one function added, one replaced), step 182 (0430) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g182$;

-- ====================================================================================================
-- migration 0430_allergy_rebuild.sql
-- ====================================================================================================

-- Allergy auto-rebuild (Ron, Oct 21: "if I have assigned them a meal plan with something ... they're allergic to and they go through and put their allergies in, AI should automatically
-- catch that and regenerate"). When a client saves their allergies or foods they avoid, the app swaps ONLY the meal options of their plan (today on) that now break a rule
-- (app/api/nutrition/allergy-rebuild, lib/allergy-conflict-rebuild.ts). This step gives that change the same record a client's "different plan" try keeps, without counting a try:
--  * meal_plan_tries.source: 'client' (every existing row and every try) or 'allergy' (a system rebuild, try_number 0). The try count (meal_plan_try_number, read from each day's rationale)
--    is untouched: an allergy rebuild changes only a day's meals, never its rationale, macros or author.
--  * apply_allergy_rebuild (server only): under the same per-client lock as a try, keeps a copy of the days it changes, replaces ONLY their meals (days that already exist, from today
--    on, in this group), and tells the client's coaches with the line the server wrote (fixed wording, never the client's own words beyond their allergy names).
--  * restore_meal_plan_try: unchanged except that an allergy rebuild cannot be put back (it would put the allergen back in front of the coach's plan); a client try older than an
--    allergy rebuild already cannot be put back (one step back at a time).
-- Re-runnable.

alter table public.meal_plan_tries add column if not exists source text not null default 'client';

do $c$
begin
  if exists (select 1 from pg_constraint where conname = 'meal_plan_tries_number_ok' and conrelid = 'public.meal_plan_tries'::regclass) then
    alter table public.meal_plan_tries drop constraint meal_plan_tries_number_ok;
  end if;
  alter table public.meal_plan_tries add constraint meal_plan_tries_number_ok
    check ((source = 'client' and try_number between 1 and 3) or (source = 'allergy' and try_number = 0));
  if not exists (select 1 from pg_constraint where conname = 'meal_plan_tries_source_ok' and conrelid = 'public.meal_plan_tries'::regclass) then
    alter table public.meal_plan_tries add constraint meal_plan_tries_source_ok check (source in ('client', 'allergy'));
  end if;
end
$c$;

create or replace function public.apply_allergy_rebuild(p_athlete_id uuid, p_group_id uuid, p_today date, p_rows jsonb, p_notice text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

revoke all on function public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text) to service_role;

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
  -- An allergy rebuild is never put back: it would put the allergen back on the plan (0430).
  if t.source = 'allergy' then
    raise exception 'allergy_rebuild';
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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 182 (0430)' as step, '0430 Allergy auto-rebuild: when a client adds an allergy or a food they avoid' as what, not ((to_regprocedure('public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)') is null)) as in_place
) as result order by step;
