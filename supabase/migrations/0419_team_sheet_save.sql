-- Release TS3: saving a filled team sheet. A coach reads the sheets in (the app checks them with the coach on a review screen first), then one call saves everything as ordinary completed, coach-logged workouts
-- on their real dates, and one call takes a whole upload back.
--
--   team_sheet_batches     one row per saved upload (who, when, how many), so it can be listed and undone. Coaches of the group read it; nothing writes it but the two functions below.
--   team_sheet_save()      for each athlete and workout: a completed, coach-logged session dated on the sheet's day, its exercises and its sets. It finishes each session with the same function a finished workout
--                          uses (complete_workout_session), so the workout log, personal records and the group's record board are written exactly as for any workout, and then puts the real date on them. It makes NO
--                          feed post, NO share card and NO per-set notice; the coach gets ONE notice summarizing the upload. An athlete who already has a session for that workout is left alone (kept) unless the coach
--                          chose to replace it. Training maxes are recomputed once at the end from the real best sets, so a Tuesday set saved on Thursday cannot overwrite a newer max.
--   team_sheet_undo()      deletes exactly the sessions that upload made (their sets, workout logs and the records they set), puts back the records they replaced, and recomputes the training maxes. A session that was
--                          REPLACED by an upload is not brought back.
-- Adds one table, one notice kind and two functions. Re-runnable.

-- the new notice kind (same widening as 0374: read the live list, add one, check it matches)
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['team_sheet_saved']) as t;
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

create table if not exists public.team_sheet_batches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('xlsx', 'csv', 'photo')),
  created_at timestamptz not null default now(),
  sessions_saved int not null default 0,
  athletes_count int not null default 0,
  records_count int not null default 0,
  kept_count int not null default 0,
  replaced_count int not null default 0,
  first_day date,
  last_day date,
  undone_at timestamptz
);
create index if not exists team_sheet_batches_group_idx on public.team_sheet_batches (group_id, created_at desc);
alter table public.team_sheet_batches enable row level security;
revoke all on public.team_sheet_batches from anon, authenticated;
grant select on public.team_sheet_batches to authenticated;
drop policy if exists team_sheet_batches_select_coach on public.team_sheet_batches;
create policy team_sheet_batches_select_coach on public.team_sheet_batches for select to authenticated using (public.is_group_coach(group_id));

-- p_rows: [{ "athlete_id": uuid, "workout_id": uuid, "day": "YYYY-MM-DD", "at": timestamptz, "exercises": [{ "id": group_workout_exercise uuid, "sets": [{ "weight": number|null, "reps": int|null }] }] }]
create or replace function public.team_sheet_save(p_group uuid, p_source text, p_rows jsonb, p_replace boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_batch uuid := gen_random_uuid();
  r jsonb;
  e jsonb;
  s jsonb;
  v_athlete uuid;
  v_workout uuid;
  v_day date;
  v_at timestamptz;
  v_existing uuid;
  v_session uuid;
  v_se uuid;
  v_gwe record;
  v_weight numeric;
  v_reps int;
  v_set_order int;
  v_sets_in_row int;
  v_saved int := 0;
  v_kept int := 0;
  v_replaced int := 0;
  v_records int := 0;
  v_prs int;
  v_skipped jsonb := '[]'::jsonb;
  v_athletes uuid[] := '{}';
  v_first date;
  v_last date;
  v_why text;
  v_pair record;
begin
  if me is null or not public.is_group_coach(p_group) or not coalesce(public.group_in_active_org(p_group), false) then
    raise exception 'not authorized';
  end if;
  if p_source not in ('xlsx', 'csv', 'photo') then
    raise exception 'unknown source';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 400 then
    raise exception 'between 1 and 400 rows are needed';
  end if;

  insert into public.team_sheet_batches (id, group_id, created_by, source) values (v_batch, p_group, me, p_source);

  -- earliest day first, so a record set on Monday is in place before Wednesday's is compared with it
  for r in select value from jsonb_array_elements(p_rows) order by (value ->> 'day'), (value ->> 'athlete_id') loop
    v_why := null;
    v_athlete := null; v_workout := null; v_day := null; v_at := null;
    begin
      v_athlete := (r ->> 'athlete_id')::uuid;
      v_workout := (r ->> 'workout_id')::uuid;
      v_day := (r ->> 'day')::date;
      v_at := (r ->> 'at')::timestamptz;
    exception when others then
      v_why := 'the row is not readable';
    end;
    if v_why is null and not exists (select 1 from public.group_memberships m where m.group_id = p_group and m.profile_id = v_athlete and m.role = 'athlete') then
      v_why := 'not an athlete of this group any more';
    end if;
    if v_why is null and not exists (select 1 from public.workouts w where w.id = v_workout and w.group_id = p_group and w.scheduled_date = v_day) then
      v_why := 'that workout is not scheduled for that day any more';
    end if;
    if v_why is null and (v_at < v_day::timestamptz - interval '1 day' or v_at > v_day::timestamptz + interval '2 days') then
      v_why := 'the time does not match the day';
    end if;
    if v_why is null and (r -> 'exercises' is null or jsonb_typeof(r -> 'exercises') <> 'array' or jsonb_array_length(r -> 'exercises') = 0 or jsonb_array_length(r -> 'exercises') > 60) then
      v_why := 'no exercises';
    end if;
    if v_why is not null then
      v_skipped := v_skipped || jsonb_build_object('athlete_id', r ->> 'athlete_id', 'day', r ->> 'day', 'why', v_why);
      continue;
    end if;

    select s2.id into v_existing from public.athlete_sessions s2 where s2.workout_id = v_workout and s2.athlete_id = v_athlete;
    if v_existing is not null then
      if not coalesce(p_replace, false) then
        v_kept := v_kept + 1;
        continue;
      end if;
      delete from public.athlete_sessions where id = v_existing;
      v_replaced := v_replaced + 1;
    end if;

    insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, started_at, logged_by_coach, is_historical, import_batch_id)
    values (v_workout, p_group, v_athlete, 'in_progress', v_at, true, false, v_batch)
    returning id into v_session;

    v_sets_in_row := 0;
    for e in select value from jsonb_array_elements(r -> 'exercises') loop
      select g.id, g.exercise_name, g.exercise_order into v_gwe from public.group_workout_exercises g where g.id = (e ->> 'id')::uuid and g.workout_id = v_workout and g.group_id = p_group;
      if not found or e -> 'sets' is null or jsonb_typeof(e -> 'sets') <> 'array' or jsonb_array_length(e -> 'sets') = 0 then
        continue;
      end if;
      if jsonb_array_length(e -> 'sets') > 20 then
        raise exception 'too many sets for one exercise';
      end if;
      insert into public.session_exercises (session_id, group_workout_exercise_id, exercise_name, exercise_order)
      values (v_session, v_gwe.id, v_gwe.exercise_name, coalesce(v_gwe.exercise_order, 0))
      returning id into v_se;
      v_set_order := 0;
      for s in select value from jsonb_array_elements(e -> 'sets') loop
        v_weight := nullif(s ->> 'weight', '')::numeric;
        v_reps := nullif(s ->> 'reps', '')::int;
        if v_weight is null and v_reps is null then
          continue;
        end if;
        if (v_weight is not null and (v_weight <= 0 or v_weight > 2000)) or (v_reps is not null and (v_reps < 1 or v_reps > 100)) then
          raise exception 'a weight or a number of reps is not believable';
        end if;
        v_set_order := v_set_order + 1;
        v_sets_in_row := v_sets_in_row + 1;
        insert into public.set_logs (session_exercise_id, set_order, weight, reps, status, completed_at, set_type)
        values (v_se, v_set_order, v_weight, v_reps, 'completed', v_at, 'working');
      end loop;
      if v_set_order = 0 then
        delete from public.session_exercises where id = v_se;
      end if;
    end loop;

    if v_sets_in_row = 0 then
      delete from public.athlete_sessions where id = v_session;
      v_skipped := v_skipped || jsonb_build_object('athlete_id', r ->> 'athlete_id', 'day', r ->> 'day', 'why', 'nothing was written');
      continue;
    end if;

    -- finish it the way any workout is finished (the workout log, personal records, the group's record board), then put the real date on it
    select coalesce(cardinality(x.new_prs), 0) into v_prs from public.complete_workout_session(v_session) x;
    update public.athlete_sessions set started_at = v_at, completed_at = v_at, duration_seconds = null where id = v_session;
    update public.workout_logs set created_at = v_at, total_duration_seconds = null where session_id = v_session;
    update public.exercise_records er set achieved_at = v_at
      where er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id where se.session_id = v_session);
    get diagnostics v_set_order = row_count;
    v_records := v_records + v_set_order;

    v_saved := v_saved + 1;
    if not (v_athlete = any (v_athletes)) then v_athletes := v_athletes || v_athlete; end if;
    if v_first is null or v_day < v_first then v_first := v_day; end if;
    if v_last is null or v_day > v_last then v_last := v_day; end if;
  end loop;

  -- training maxes come from the real best sets, whatever order the sheets were saved in
  for v_pair in
    select distinct s3.athlete_id, se.exercise_name
    from public.athlete_sessions s3 join public.session_exercises se on se.session_id = s3.id
    where s3.import_batch_id = v_batch
  loop
    perform public.recompute_training_maxes_internal(v_pair.athlete_id, v_pair.exercise_name);
  end loop;

  update public.team_sheet_batches
    set sessions_saved = v_saved, athletes_count = coalesce(cardinality(v_athletes), 0), records_count = v_records, kept_count = v_kept, replaced_count = v_replaced, first_day = v_first, last_day = v_last
    where id = v_batch;

  -- ONE notice for the whole upload, to the coach; nothing goes to the athletes
  if v_saved > 0 then
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (me, p_group, 'team_sheet_saved',
      'Team sheet saved: ' || v_saved::text || ' workout' || case when v_saved = 1 then '' else 's' end || ' for ' || coalesce(cardinality(v_athletes), 0)::text || ' athlete' || case when coalesce(cardinality(v_athletes), 0) = 1 then '' else 's' end
        || case when v_records > 0 then ', ' || v_records::text || ' new record' || case when v_records = 1 then '' else 's' end else '' end || '. You can undo it from the Team sheet page.',
      '/groups/' || p_group::text || '/team-sheet');
  else
    delete from public.team_sheet_batches where id = v_batch and sessions_saved = 0 and kept_count = 0;
  end if;

  return jsonb_build_object('batch', case when v_saved > 0 or v_kept > 0 then v_batch else null end, 'saved', v_saved, 'kept', v_kept, 'replaced', v_replaced, 'records', v_records, 'skipped', v_skipped);
end;
$$;
revoke execute on function public.team_sheet_save(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.team_sheet_save(uuid, text, jsonb, boolean) to authenticated;

create or replace function public.team_sheet_undo(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.team_sheet_batches%rowtype;
  v_sessions int := 0;
  v_pair record;
  v_key record;
begin
  select * into b from public.team_sheet_batches where id = p_batch for update;
  if not found or me is null or not public.is_group_coach(b.group_id) then
    raise exception 'that upload was not found';
  end if;
  if b.undone_at is not null then
    raise exception 'that upload was already undone';
  end if;

  -- what has to be recomputed afterwards
  create temporary table if not exists _ts_pairs (athlete_id uuid, exercise_name text) on commit drop;
  delete from _ts_pairs;
  insert into _ts_pairs
    select distinct s.athlete_id, se.exercise_name from public.athlete_sessions s join public.session_exercises se on se.session_id = s.id where s.import_batch_id = p_batch and s.group_id = b.group_id;
  create temporary table if not exists _ts_keys (exercise_name text, tracked_field text) on commit drop;
  delete from _ts_keys;
  insert into _ts_keys
    select distinct er.exercise_name, er.tracked_field from public.exercise_records er
    where er.group_id = b.group_id and er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.import_batch_id = p_batch and s.group_id = b.group_id);

  delete from public.exercise_records er
    where er.group_id = b.group_id and er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.import_batch_id = p_batch and s.group_id = b.group_id);

  with gone as (delete from public.athlete_sessions where import_batch_id = p_batch and group_id = b.group_id and logged_by_coach returning id)
  select count(*) into v_sessions from gone;

  -- where the upload's record was the holder, the record it replaced is the holder again (the one it superseded at the moment of the upload)
  for v_key in select * from _ts_keys loop
    if not exists (select 1 from public.exercise_records er where er.group_id = b.group_id and er.exercise_name = v_key.exercise_name and er.tracked_field = v_key.tracked_field and er.superseded_at is null) then
      update public.exercise_records er set superseded_at = null
        where er.id = (
          select p.id from public.exercise_records p
          where p.group_id = b.group_id and p.exercise_name = v_key.exercise_name and p.tracked_field = v_key.tracked_field and p.superseded_at = b.created_at
          order by p.value desc, p.achieved_at desc limit 1
        );
    end if;
  end loop;

  for v_pair in select * from _ts_pairs loop
    perform public.recompute_training_maxes_internal(v_pair.athlete_id, v_pair.exercise_name);
  end loop;

  update public.team_sheet_batches set undone_at = now() where id = p_batch;
  return jsonb_build_object('batch', p_batch, 'sessions_removed', v_sessions);
end;
$$;
revoke execute on function public.team_sheet_undo(uuid) from public, anon;
grant execute on function public.team_sheet_undo(uuid) to authenticated;
