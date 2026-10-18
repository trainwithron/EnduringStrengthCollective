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
-- A row that cannot be saved is skipped with its reason and the rest are saved; a session being replaced is only deleted if its replacement is written. Rows are matched to the workout the sheet was printed for
-- (workouts have no date of their own); a client who has been set aside is skipped, not quietly brought back. Undo puts the board's holder back by the record's own direction, in any order.
-- Adds one table, one notice kind and three functions (one of them private). Re-runnable.

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

-- Makes the best remaining record the current one for an exercise on the group's record board, when none is current (after records were deleted). Used by the save (replacing a session) and by the undo. Not callable by anyone signed in.
create or replace function public.team_sheet_fix_record(p_group uuid, p_exercise text, p_field text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.exercise_records er where er.group_id = p_group and er.exercise_name = p_exercise and er.tracked_field = p_field and er.superseded_at is null) then
    return;
  end if;
  update public.exercise_records er set superseded_at = null
    where er.id = (
      select p.id from public.exercise_records p
      where p.group_id = p_group and p.exercise_name = p_exercise and p.tracked_field = p_field
      order by case when p.direction = 'lower_better' then -p.value else p.value end desc, p.achieved_at desc, p.id
      limit 1
    );
end;
$$;
revoke execute on function public.team_sheet_fix_record(uuid, text, text) from public, anon, authenticated;

-- p_rows: [{ "athlete_id": uuid, "workout_id": uuid, "day": "YYYY-MM-DD", "at": timestamptz, "exercises": [{ "id": group_workout_exercise uuid, "sets": [{ "weight": number|null, "reps": int|null }] }] }]
-- A big upload is sent in pieces so no single call is long: the first call starts the upload (p_batch null), each later call adds to it (p_batch = the upload's id), and the last (p_last true, the default) writes the one notice.
-- Each row is saved on its own: a row that cannot be saved is skipped with its reason (and anything it began is rolled back, including a session it was going to replace), and the others are saved.
create or replace function public.team_sheet_save(p_group uuid, p_source text, p_rows jsonb, p_replace boolean default false, p_batch uuid default null, p_last boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  me uuid := auth.uid();
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  b public.team_sheet_batches%rowtype;
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
  v_reps_n numeric;
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
  v_key record;
  v_seen text[] := '{}';
  v_ex_seen uuid[];
  v_row_ok boolean;
  v_row_replaced boolean;
  v_row_names text[];
  v_pairs jsonb := '[]'::jsonb;
begin
  if me is null or not public.is_group_coach(p_group) or not coalesce(public.group_in_active_org(p_group), false) then
    raise exception 'not authorized';
  end if;
  if p_source is null or p_source not in ('xlsx', 'csv', 'photo') then
    raise exception 'unknown source';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 400 or (jsonb_array_length(p_rows) = 0 and (p_batch is null or not coalesce(p_last, true))) then
    raise exception 'between 1 and 400 rows are needed';
  end if;

  if p_batch is null then
    insert into public.team_sheet_batches (id, group_id, created_by, source) values (v_batch, p_group, me, p_source);
  else
    -- adding to an upload this coach started, that has not been undone
    select * into b from public.team_sheet_batches where id = p_batch and group_id = p_group and created_by = me and undone_at is null for update;
    if not found then
      raise exception 'that upload was not found';
    end if;
  end if;

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
    if v_why is null and (v_athlete is null or v_workout is null or v_day is null or v_at is null) then
      v_why := 'the row is not readable';
    end if;
    -- the workout is the one the sheet was printed for (its id is on the sheet); workouts have no date of their own, so the day is only where the session is placed
    if v_why is null and (v_athlete::text || '/' || v_workout::text) = any (v_seen) then
      v_why := 'this athlete is listed twice for this workout';
    end if;
    if v_why is null and not exists (select 1 from public.group_memberships m where m.group_id = p_group and m.profile_id = v_athlete and m.role = 'athlete') then
      v_why := 'not an athlete of this group any more';
    end if;
    if v_why is null and not exists (
      select 1 from public.workouts w join public.programs pr on pr.id = w.program_id
      where w.id = v_workout and w.group_id = p_group and pr.group_id = p_group and pr.is_active and pr.athlete_id is null
    ) then
      v_why := 'that workout is not in an active program of this group any more';
    end if;
    if v_why is null and (v_day > current_date + 1 or v_at > now() + interval '1 day') then
      v_why := 'that day is in the future';
    end if;
    if v_why is null and (v_at < v_day::timestamptz - interval '1 day' or v_at > v_day::timestamptz + interval '2 days') then
      v_why := 'the time does not match the day';
    end if;
    if v_why is null and exists (select 1 from public.client_inactive ci where ci.group_id = p_group and ci.athlete_id = v_athlete) then
      v_why := 'set aside as inactive (bring them back first)';
    end if;
    if v_why is null and (r -> 'exercises' is null or jsonb_typeof(r -> 'exercises') <> 'array' or jsonb_array_length(r -> 'exercises') = 0 or jsonb_array_length(r -> 'exercises') > 60) then
      v_why := 'no exercises';
    end if;
    if v_why is not null then
      v_skipped := v_skipped || jsonb_build_object('athlete_id', r ->> 'athlete_id', 'day', r ->> 'day', 'why', v_why);
      continue;
    end if;
    v_seen := v_seen || (v_athlete::text || '/' || v_workout::text);

    select s2.id into v_existing from public.athlete_sessions s2 where s2.workout_id = v_workout and s2.athlete_id = v_athlete;
    if v_existing is not null and not coalesce(p_replace, false) then
      v_kept := v_kept + 1;
      continue;
    end if;

    v_row_ok := false;
    v_row_replaced := false;
    v_row_names := '{}';
    begin
      if v_existing is not null then
        -- the session being replaced: remember what its exercises were (their training maxes are recomputed at the end), take the records it set off the board, and put the best remaining ones back
        select coalesce(array_agg(se0.exercise_name), '{}') into v_row_names from public.session_exercises se0 where se0.session_id = v_existing;
        for v_key in
          select distinct er.exercise_name, er.tracked_field from public.exercise_records er
          where er.group_id = p_group and er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id where se.session_id = v_existing)
        loop
          delete from public.exercise_records er
            where er.group_id = p_group and er.exercise_name = v_key.exercise_name and er.tracked_field = v_key.tracked_field
              and er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id where se.session_id = v_existing);
          perform public.team_sheet_fix_record(p_group, v_key.exercise_name, v_key.tracked_field);
        end loop;
        delete from public.athlete_sessions where id = v_existing;
        v_row_replaced := true;
      end if;

      insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, started_at, logged_by_coach, is_historical, import_batch_id)
      values (v_workout, p_group, v_athlete, 'in_progress', v_at, true, false, v_batch)
      returning id into v_session;

      v_sets_in_row := 0;
      v_ex_seen := '{}';
      for e in select value from jsonb_array_elements(r -> 'exercises') loop
        select g.id, g.exercise_name, g.exercise_order into v_gwe from public.group_workout_exercises g
          where g.id = (e ->> 'id')::uuid and g.workout_id = v_workout and g.group_id = p_group and g.athlete_id is null;
        if not found then
          raise exception 'team_sheet: an exercise on the sheet is no longer in that workout (it changed after the sheet was printed)';
        end if;
        if v_gwe.id = any (v_ex_seen) then
          raise exception 'team_sheet: an exercise is listed twice';
        end if;
        v_ex_seen := v_ex_seen || v_gwe.id;
        if e -> 'sets' is null or jsonb_typeof(e -> 'sets') <> 'array' or jsonb_array_length(e -> 'sets') = 0 then
          continue;
        end if;
        if jsonb_array_length(e -> 'sets') > 20 then
          raise exception 'team_sheet: too many sets for one exercise';
        end if;
        insert into public.session_exercises (session_id, group_workout_exercise_id, exercise_name, exercise_order)
        values (v_session, v_gwe.id, v_gwe.exercise_name, coalesce(v_gwe.exercise_order, 0))
        returning id into v_se;
        v_set_order := 0;
        for s in select value from jsonb_array_elements(e -> 'sets') loop
          v_weight := nullif(s ->> 'weight', '')::numeric;
          v_reps_n := nullif(s ->> 'reps', '')::numeric;
          -- a 0 in a weight box is nothing written, not a weight
          if v_weight = 0 then v_weight := null; end if;
          if v_weight is null and v_reps_n is null then
            continue;
          end if;
          if v_reps_n is not null and v_reps_n <> trunc(v_reps_n) then
            raise exception 'team_sheet: a number of reps is not a whole number';
          end if;
          v_reps := v_reps_n::int;
          if (v_weight is not null and (v_weight < 0 or v_weight > 2000)) or (v_reps is not null and (v_reps < 1 or v_reps > 100)) then
            raise exception 'team_sheet: a weight or a number of reps is not believable';
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
        raise exception 'team_sheet: nothing was written (every box was empty)';
      end if;

      -- finish it the way any workout is finished (the workout log, personal records, the group's record board), then put the real date on it
      select coalesce(cardinality(x.new_prs), 0) into v_prs from public.complete_workout_session(v_session) x;
      update public.athlete_sessions set started_at = v_at, completed_at = v_at, duration_seconds = null where id = v_session;
      update public.workout_logs set created_at = v_at, total_duration_seconds = null where session_id = v_session;
      update public.exercise_records er set achieved_at = v_at
        where er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id where se.session_id = v_session);
      v_row_ok := true;
    exception when others then
      v_why := case when sqlerrm like 'team_sheet: %' then substr(sqlerrm, 13) else 'the row has a value that could not be read' end;
    end;

    if not v_row_ok then
      v_skipped := v_skipped || jsonb_build_object('athlete_id', r ->> 'athlete_id', 'day', r ->> 'day', 'why', v_why);
      continue;
    end if;

    v_saved := v_saved + 1;
    if v_row_replaced then
      v_replaced := v_replaced + 1;
      select v_pairs || coalesce(jsonb_agg(jsonb_build_object('a', v_athlete, 'n', n)), '[]'::jsonb) into v_pairs from unnest(v_row_names) as n;
    end if;
    select v_pairs || coalesce(jsonb_agg(distinct jsonb_build_object('a', v_athlete, 'n', se1.exercise_name)), '[]'::jsonb) into v_pairs from public.session_exercises se1 where se1.session_id = v_session;
    if not (v_athlete = any (v_athletes)) then v_athletes := v_athletes || v_athlete; end if;
    if v_first is null or v_day < v_first then v_first := v_day; end if;
    if v_last is null or v_day > v_last then v_last := v_day; end if;
  end loop;

  -- training maxes come from the real best sets, whatever order the sheets were saved in (and for the exercises of any session that was replaced)
  for v_pair in
    select distinct (x ->> 'a')::uuid as athlete_id, x ->> 'n' as exercise_name from jsonb_array_elements(v_pairs) as x
  loop
    perform public.recompute_training_maxes_internal(v_pair.athlete_id, v_pair.exercise_name);
  end loop;

  -- the records that are still the board's holder after the whole upload so far
  select count(*) into v_records from public.exercise_records er
    where er.group_id = p_group and er.superseded_at is null
      and er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s4 on s4.id = se.session_id where s4.import_batch_id = v_batch);

  update public.team_sheet_batches t0
    set sessions_saved = t0.sessions_saved + v_saved,
        athletes_count = (select count(distinct s5.athlete_id)::int from public.athlete_sessions s5 where s5.import_batch_id = v_batch),
        records_count = v_records,
        kept_count = t0.kept_count + v_kept,
        replaced_count = t0.replaced_count + v_replaced,
        first_day = least(t0.first_day, v_first),
        last_day = greatest(t0.last_day, v_last)
    where t0.id = v_batch
    returning * into b;

  if coalesce(p_last, true) then
    if b.sessions_saved > 0 then
      -- ONE notice for the whole upload, to the coach; nothing goes to the athletes
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (me, p_group, 'team_sheet_saved',
        'Team sheet saved: ' || b.sessions_saved::text || ' workout' || case when b.sessions_saved = 1 then '' else 's' end || ' for ' || b.athletes_count::text || ' athlete' || case when b.athletes_count = 1 then '' else 's' end
          || case when b.records_count > 0 then ', ' || b.records_count::text || ' new record' || case when b.records_count = 1 then '' else 's' end else '' end || '. You can undo it from the Team sheet page.',
        '/groups/' || p_group::text || '/team-sheet');
    else
      -- an upload that saved nothing (everyone already had a session, or every row was refused) leaves no record to undo
      delete from public.team_sheet_batches where id = v_batch;
    end if;
  end if;

  return jsonb_build_object('batch', case when coalesce(p_last, true) and b.sessions_saved = 0 then null else v_batch end, 'saved', v_saved, 'kept', v_kept, 'replaced', v_replaced, 'records', v_records, 'total_saved', b.sessions_saved, 'skipped', v_skipped);
end;
$$;
revoke execute on function public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean) from public, anon;
grant execute on function public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean) to authenticated;

create or replace function public.team_sheet_undo(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  me uuid := auth.uid();
  b public.team_sheet_batches%rowtype;
  v_sessions int := 0;
  v_pairs jsonb;
  v_keys jsonb;
  x jsonb;
begin
  select * into b from public.team_sheet_batches where id = p_batch for update;
  if not found or me is null or not public.is_group_coach(b.group_id) or not coalesce(public.group_in_active_org(b.group_id), false) then
    raise exception 'that upload was not found';
  end if;
  if b.undone_at is not null then
    raise exception 'that upload was already undone';
  end if;

  -- what has to be put right afterwards
  select coalesce(jsonb_agg(distinct jsonb_build_object('a', s.athlete_id, 'n', se.exercise_name)), '[]'::jsonb) into v_pairs
    from public.athlete_sessions s join public.session_exercises se on se.session_id = s.id where s.import_batch_id = p_batch and s.group_id = b.group_id;
  select coalesce(jsonb_agg(distinct jsonb_build_object('n', er.exercise_name, 'f', er.tracked_field)), '[]'::jsonb) into v_keys
    from public.exercise_records er
    where er.group_id = b.group_id and er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.import_batch_id = p_batch and s.group_id = b.group_id);

  delete from public.exercise_records er
    where er.group_id = b.group_id and er.set_log_id in (select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.import_batch_id = p_batch and s.group_id = b.group_id);

  with gone as (delete from public.athlete_sessions where import_batch_id = p_batch and group_id = b.group_id and logged_by_coach returning id)
  select count(*) into v_sessions from gone;

  -- wherever the board has no holder now, the best record that is left (by its own direction) is the holder again, whatever order uploads are undone in
  for x in select value from jsonb_array_elements(v_keys) loop
    perform public.team_sheet_fix_record(b.group_id, x ->> 'n', x ->> 'f');
  end loop;

  for x in select value from jsonb_array_elements(v_pairs) loop
    perform public.recompute_training_maxes_internal((x ->> 'a')::uuid, x ->> 'n');
  end loop;

  update public.team_sheet_batches set undone_at = now() where id = p_batch;
  return jsonb_build_object('batch', p_batch, 'sessions_removed', v_sessions);
end;
$$;
revoke execute on function public.team_sheet_undo(uuid) from public, anon;
grant execute on function public.team_sheet_undo(uuid) to authenticated;
