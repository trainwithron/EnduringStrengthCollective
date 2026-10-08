-- Release R: a client can ask for a different meal plan ("Not feeling it? Tell us what to change"), up to 3 times per plan the coach assigned. The rebuild is automatic and uses the
-- recipe library only; nothing the client types is sent to an AI.
--  * meal_plan_tries: one row per try (who, which try of 3, what they typed, a fixed-wording summary of what was understood, the days rebuilt, and a SNAPSHOT of the plan those
--    days had before). The client reads their own, the client's coach reads them; nobody can write to it directly (only the two functions below).
--  * apply_meal_plan_try (server only): under one lock per client it counts the tries already used on the plan that is standing now (the try number is written into each rebuilt day's
--    rationale, so a coach who assigns a new plan resets it), refuses a 4th, refuses a day the coach built by hand, keeps the snapshot, replaces the days, and tells the client's
--    coaches with FIXED wording (never the client's own words).
--  * restore_meal_plan_try (a coach of the client's group): puts back the plan from before the LATEST try, one step at a time, and only the days still as that try left them (a day the
--    coach changed by hand since is left alone).
--  * Notification type 'meal_plan_try', added to the list the database ALREADY has (read at apply time, never typed from an older migration).
-- New objects only. Re-runnable.

do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['meal_plan_try']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

create table if not exists public.meal_plan_tries (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  try_number smallint not null,
  note text not null default '',
  summary text not null default '',
  dates date[] not null,
  previous_plan jsonb not null default '[]'::jsonb,
  requested_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid references public.profiles(id) on delete set null,
  constraint meal_plan_tries_number_ok check (try_number between 1 and 3),
  constraint meal_plan_tries_note_ok check (char_length(note) <= 300),
  constraint meal_plan_tries_summary_ok check (char_length(summary) <= 300),
  constraint meal_plan_tries_dates_ok check (cardinality(dates) between 1 and 31)
);
create index if not exists meal_plan_tries_athlete_idx on public.meal_plan_tries (athlete_id, requested_at desc);
create index if not exists meal_plan_tries_group_idx on public.meal_plan_tries (group_id);
create index if not exists meal_plan_tries_restored_by_idx on public.meal_plan_tries (restored_by);

alter table public.meal_plan_tries enable row level security;

drop policy if exists "meal_plan_tries_select" on public.meal_plan_tries;
create policy "meal_plan_tries_select" on public.meal_plan_tries for select
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
-- No insert, update or delete policy: the two functions below are the only way a row changes.

-- The rationale a rebuilt day carries: the try number is read back from it (here and in the app), so a coach who assigns a new plan, or edits a day by hand, changes what it says.
create or replace function public.meal_plan_try_number(p_rationale text)
returns int
language sql
immutable
set search_path to 'public'
as $function$
  select (substring(p_rationale from '^Rebuilt at the client''s request \(try ([1-3]) of 3\)\.$'))::int;
$function$;

create or replace function public.apply_meal_plan_try(p_athlete_id uuid, p_group_id uuid, p_today date, p_rows jsonb, p_note text, p_summary text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

revoke all on function public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text) to service_role;

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
