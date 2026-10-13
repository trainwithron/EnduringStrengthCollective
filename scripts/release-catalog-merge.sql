-- Release BQ: Coach Ron's exercise names, decided by Ron on Oct 12 (the implement is stated, singular). ONLY his library (created_by 136394ed-f108-4283-bcb7-310a1ac6cbc8) and his world are touched.
--   * 9 merges ("A + B -> final name"): two entries become one. The one that already carries the final name (or the first one listed) is kept; a video is moved onto it if it has none.
--   * 7 renames (a plain name gets its implement) and 2 plain names that merge into an implement-named entry that already exists.
-- For each old name the exercise name is rewritten to the final one wherever it is stored as text in Ron's world (his programs, his clients' sessions, records, patterns, tags, maxes), every set
-- and log row is kept, the old name is saved as an alias so typing it again finds the final one, and a duplicate library row is deleted. Then the shared catalog is filled from his library
-- (including the four FitPros exercises) and each library row is linked to its catalog entry. Nothing belonging to any other coach is touched. All or nothing: a missing entry stops everything.
-- Every row changed or deleted is first written to exercise_catalog_merge_log / exercise_catalog_merge_deleted (server-only), which is what the undo file reads. To see the rows changed per table:
--   select tbl, col, count(*) from public.exercise_catalog_merge_log group by tbl, col order by tbl, col;

create table public.exercise_catalog_merge_log (
  id bigserial primary key,
  tbl text not null,
  row_id text not null,
  col text not null,
  old_value jsonb,
  new_value jsonb,
  merged_at timestamptz not null default now()
);
create table public.exercise_catalog_merge_deleted (
  id bigserial primary key,
  tbl text not null,
  row jsonb not null,
  merged_at timestamptz not null default now()
);
alter table public.exercise_catalog_merge_log enable row level security;
alter table public.exercise_catalog_merge_deleted enable row level security;
revoke all on public.exercise_catalog_merge_log from anon, authenticated;
revoke all on public.exercise_catalog_merge_deleted from anon, authenticated;

do $merge$
declare
  v_ron constant uuid := '136394ed-f108-4283-bcb7-310a1ac6cbc8';
  -- old name, final name (the one that holds the video is listed first when two entries merge into a final name nobody has yet)
  v_pairs constant text[] := array[
    'Back Squat', 'Barbell Back Squat',
    'Barbell Back Squats', 'Barbell Back Squat',
    'Front Squat', 'Barbell Front Squat',
    'Barbell Front Squats', 'Barbell Front Squat',
    'Leg Extension Machine', 'Leg Extension',
    'Dumbbell Tricep Skull Crushers', 'Dumbbell Skull Crusher',
    'Incline Dumbbell Press', 'Incline Dumbbell Bench Press',
    'Suitcase Carry (Single Arm Farmers Carry)', 'Suitcase Carry',
    'Single Arm Farmers Carry', 'Suitcase Carry',
    'Russian Kettlebell Swing', 'Kettlebell Swing',
    'Face Pull', 'Banded Face Pull',
    'Cable Face Pulls', 'Cable Face Pull',
    'Romanian Deadlift', 'Barbell Romanian Deadlift',
    'Reverse Lunge', 'Dumbbell Reverse Lunge',
    'Rear Foot Elevated Split Squat', 'Dumbbell Rear Foot Elevated Split Squat',
    'Split Squat', 'Dumbbell Split Squat',
    'Box Squat', 'Barbell Box Squat',
    'Lat Pulldown', 'Cable Lat Pulldown',
    'Walking Lunge', 'Dumbbell Walking Lunge'
  ];
  i int;
  v_loser text;
  v_final text;
  v_loser_id uuid;
  v_final_id uuid;
  v_new_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_ron) then
    raise exception 'Coach Ron''s profile is not here, so nothing was merged.';
  end if;

  -- Ron's world: the groups he coaches, and the clients in them.
  create temp table _ron_groups on commit drop as
    select group_id from public.group_memberships where profile_id = v_ron and role = 'coach';
  create temp table _ron_athletes on commit drop as
    select distinct profile_id from public.group_memberships where group_id in (select group_id from _ron_groups) and role = 'athlete';
  create temp table _cm_pairs (old_name text, final_name text) on commit drop;

  for i in 1 .. array_length(v_pairs, 1) / 2 loop
    v_loser := v_pairs[2 * i - 1];
    v_final := v_pairs[2 * i];
    insert into _cm_pairs values (v_loser, v_final);

    select id into v_loser_id from public.exercise_library where created_by = v_ron and name = v_loser;
    if v_loser_id is null then
      raise exception 'Ron''s library has no "%" to merge or rename, so nothing was changed.', v_loser;
    end if;
    select id into v_final_id from public.exercise_library where created_by = v_ron and name = v_final;

    -- program exercises
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'group_workout_exercises', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_final)
      from public.group_workout_exercises x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.group_workout_exercises set exercise_name = v_final
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- exercises inside logged and live sessions
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'session_exercises', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_final)
      from public.session_exercises x join public.athlete_sessions s on s.id = x.session_id
      where x.exercise_name = v_loser and s.group_id in (select group_id from _ron_groups);
    update public.session_exercises x set exercise_name = v_final
      from public.athlete_sessions s
      where s.id = x.session_id and x.exercise_name = v_loser and s.group_id in (select group_id from _ron_groups);

    -- per-client swaps
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'athlete_exercise_overrides', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_final)
      from public.athlete_exercise_overrides x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.athlete_exercise_overrides set exercise_name = v_final
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- progression rules (one per program and exercise: where a program already has the final name's, that one is kept)
    insert into public.exercise_catalog_merge_deleted (tbl, row)
      select 'exercise_progressions', to_jsonb(x) from public.exercise_progressions x
      where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups)
        and exists (select 1 from public.exercise_progressions s where s.program_id = x.program_id and s.exercise_name = v_final);
    delete from public.exercise_progressions x
      where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups)
        and exists (select 1 from public.exercise_progressions s where s.program_id = x.program_id and s.exercise_name = v_final);
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'exercise_progressions', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_final)
      from public.exercise_progressions x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.exercise_progressions set exercise_name = v_final
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- records
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'exercise_records', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_final)
      from public.exercise_records x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.exercise_records set exercise_name = v_final
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- game scores
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'game_score_entries', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_final)
      from public.game_score_entries x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.game_score_entries set exercise_name = v_final
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- Ron's movement patterns and tiers (where a pattern already has the final name, that row and its tier are kept)
    insert into public.exercise_catalog_merge_deleted (tbl, row)
      select 'movement_pattern_exercises', to_jsonb(x) from public.movement_pattern_exercises x
      join public.movement_patterns p on p.id = x.movement_pattern_id
      where x.exercise_name = v_loser and p.created_by = v_ron
        and exists (select 1 from public.movement_pattern_exercises s where s.movement_pattern_id = x.movement_pattern_id and s.exercise_name = v_final);
    delete from public.movement_pattern_exercises x using public.movement_patterns p
      where p.id = x.movement_pattern_id and x.exercise_name = v_loser and p.created_by = v_ron
        and exists (select 1 from public.movement_pattern_exercises s where s.movement_pattern_id = x.movement_pattern_id and s.exercise_name = v_final);
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'movement_pattern_exercises', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_final)
      from public.movement_pattern_exercises x join public.movement_patterns p on p.id = x.movement_pattern_id
      where x.exercise_name = v_loser and p.created_by = v_ron;
    update public.movement_pattern_exercises x set exercise_name = v_final
      from public.movement_patterns p
      where p.id = x.movement_pattern_id and x.exercise_name = v_loser and p.created_by = v_ron;

    -- Ron's tags on the exercise (where the final name already has the same tag, the old one is dropped; the row is kept in the deleted log)
    insert into public.exercise_catalog_merge_deleted (tbl, row)
      select 'exercise_biomech_tags', to_jsonb(x) from public.exercise_biomech_tags x
      where x.exercise_name = v_loser and x.created_by = v_ron
        and exists (select 1 from public.exercise_biomech_tags s where s.exercise_name = v_final and s.tag_id = x.tag_id);
    delete from public.exercise_biomech_tags x
      where x.exercise_name = v_loser and x.created_by = v_ron
        and exists (select 1 from public.exercise_biomech_tags s where s.exercise_name = v_final and s.tag_id = x.tag_id);
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'exercise_biomech_tags', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_final)
      from public.exercise_biomech_tags x where x.exercise_name = v_loser and x.created_by = v_ron;
    update public.exercise_biomech_tags set exercise_name = v_final where exercise_name = v_loser and created_by = v_ron;

    -- his clients' load ratios (the training maxes are handled once, after this loop)
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'athlete_equipment_load_ratios', x.id::text, 'exercise_name_a', to_jsonb(v_loser), to_jsonb(v_final)
      from public.athlete_equipment_load_ratios x where x.exercise_name_a = v_loser and x.athlete_id in (select profile_id from _ron_athletes);
    update public.athlete_equipment_load_ratios set exercise_name_a = v_final
      where exercise_name_a = v_loser and athlete_id in (select profile_id from _ron_athletes);
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'athlete_equipment_load_ratios', x.id::text, 'exercise_name_b', to_jsonb(v_loser), to_jsonb(v_final)
      from public.athlete_equipment_load_ratios x where x.exercise_name_b = v_loser and x.athlete_id in (select profile_id from _ron_athletes);
    update public.athlete_equipment_load_ratios set exercise_name_b = v_final
      where exercise_name_b = v_loser and athlete_id in (select profile_id from _ron_athletes);

    -- PR lists on logged workouts and exercises shared on posts
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'workout_logs', x.id::text, 'new_prs', to_jsonb(x.new_prs), to_jsonb(array_replace(x.new_prs, v_loser, v_final))
      from public.workout_logs x where x.group_id in (select group_id from _ron_groups) and v_loser = any (x.new_prs);
    update public.workout_logs set new_prs = array_replace(new_prs, v_loser, v_final)
      where group_id in (select group_id from _ron_groups) and v_loser = any (new_prs);
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'posts', x.id::text, 'shared_exercise_names', to_jsonb(x.shared_exercise_names), to_jsonb(array_replace(x.shared_exercise_names, v_loser, v_final))
      from public.posts x where x.group_id in (select group_id from _ron_groups) and v_loser = any (x.shared_exercise_names);
    update public.posts set shared_exercise_names = array_replace(shared_exercise_names, v_loser, v_final)
      where group_id in (select group_id from _ron_groups) and v_loser = any (shared_exercise_names);

    -- Ron's aliases: the ones pointing at the old name now point at the final one, and the old name itself becomes an alias of the final one
    insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
      select 'exercise_aliases', x.id::text, 'exercise_name', to_jsonb(x.exercise_name), to_jsonb(v_final)
      from public.exercise_aliases x
      where x.coach_id = v_ron and (x.exercise_name = v_loser or (x.raw_name = v_loser and x.exercise_name <> v_final));
    update public.exercise_aliases set exercise_name = v_final
      where coach_id = v_ron and (exercise_name = v_loser or (raw_name = v_loser and exercise_name <> v_final));
    v_new_id := null;
    insert into public.exercise_aliases (coach_id, raw_name, exercise_name) values (v_ron, v_loser, v_final)
      on conflict (coach_id, raw_name) do nothing returning id into v_new_id;
    if v_new_id is not null then
      insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value) values ('exercise_aliases', v_new_id::text, '__inserted', null, to_jsonb(v_loser));
    end if;

    -- the library row itself
    if v_final_id is null then
      -- nobody has the final name yet: this entry is renamed (its video and notes stay with it)
      insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
        values ('exercise_library', v_loser_id::text, 'name', to_jsonb(v_loser), to_jsonb(v_final));
      update public.exercise_library set name = v_final where id = v_loser_id;
    else
      -- the entry that already has the final name is kept; it takes the old one's video, category and equipment where it has none
      insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
        select 'exercise_library', f.id::text, 'video_path', to_jsonb(f.video_path), to_jsonb(l.video_path)
        from public.exercise_library f, public.exercise_library l
        where f.id = v_final_id and l.id = v_loser_id and f.video_path is null and f.youtube_url is null and l.video_path is not null;
      insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
        select 'exercise_library', f.id::text, 'youtube_url', to_jsonb(f.youtube_url), to_jsonb(l.youtube_url)
        from public.exercise_library f, public.exercise_library l
        where f.id = v_final_id and l.id = v_loser_id and f.video_path is null and f.youtube_url is null and l.youtube_url is not null;
      update public.exercise_library f
        set video_path = coalesce(f.video_path, l.video_path), youtube_url = coalesce(f.youtube_url, l.youtube_url)
        from public.exercise_library l
        where f.id = v_final_id and l.id = v_loser_id and f.video_path is null and f.youtube_url is null;
      insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
        select 'exercise_library', f.id::text, 'category', to_jsonb(f.category), to_jsonb(l.category)
        from public.exercise_library f, public.exercise_library l
        where f.id = v_final_id and l.id = v_loser_id and f.category is null and l.category is not null;
      update public.exercise_library f set category = l.category
        from public.exercise_library l where f.id = v_final_id and l.id = v_loser_id and f.category is null and l.category is not null;
      insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
        select 'exercise_library', f.id::text, 'equipment_type', to_jsonb(f.equipment_type), to_jsonb(l.equipment_type)
        from public.exercise_library f, public.exercise_library l
        where f.id = v_final_id and l.id = v_loser_id and f.equipment_type is null and l.equipment_type is not null;
      update public.exercise_library f set equipment_type = l.equipment_type
        from public.exercise_library l where f.id = v_final_id and l.id = v_loser_id and f.equipment_type is null and l.equipment_type is not null;
      insert into public.exercise_catalog_merge_deleted (tbl, row)
        select 'exercise_library', to_jsonb(l) from public.exercise_library l where l.id = v_loser_id;
      delete from public.exercise_library where id = v_loser_id;
    end if;
  end loop;

  -- His clients' training maxes, once for all the names: a client who has a max under several names of the same final exercise keeps the highest one (the others are kept in the
  -- deleted log), and the kept one takes the final name.
  create temp table _cm_tm on commit drop as
    select x.athlete_id, x.exercise_name, m.final_name,
      row_number() over (partition by x.athlete_id, m.final_name order by x.estimated_max desc nulls last, (x.exercise_name = m.final_name) desc, x.exercise_name) as rn
    from public.athlete_training_maxes x
    join (select old_name, final_name from _cm_pairs union select final_name, final_name from _cm_pairs) m on m.old_name = x.exercise_name
    where x.athlete_id in (select profile_id from _ron_athletes);
  insert into public.exercise_catalog_merge_deleted (tbl, row)
    select 'athlete_training_maxes', to_jsonb(x) from public.athlete_training_maxes x
    join _cm_tm t on t.athlete_id = x.athlete_id and t.exercise_name = x.exercise_name where t.rn > 1;
  delete from public.athlete_training_maxes x using _cm_tm t
    where t.athlete_id = x.athlete_id and t.exercise_name = x.exercise_name and t.rn > 1;
  insert into public.exercise_catalog_merge_log (tbl, row_id, col, old_value, new_value)
    select 'athlete_training_maxes', t.athlete_id::text, 'exercise_name', to_jsonb(t.exercise_name), to_jsonb(t.final_name)
    from _cm_tm t where t.rn = 1 and t.exercise_name <> t.final_name;
  update public.athlete_training_maxes x set exercise_name = t.final_name from _cm_tm t
    where t.rn = 1 and t.exercise_name <> t.final_name and t.athlete_id = x.athlete_id and x.exercise_name = t.exercise_name;

  -- The shared catalog: one entry per exercise in Ron's library now (the four FitPros exercises included), each library row linked to its entry,
  -- and every spelling (the final names and every old name) recorded as an alias of its entry.
  insert into public.exercise_catalog (name, category, equipment, batch)
    select distinct on (lower(l.name)) l.name, l.category, l.equipment_type, 'ron-merge-1'
    from public.exercise_library l where l.created_by = v_ron order by lower(l.name), l.created_at;
  update public.exercise_library l set catalog_id = c.id
    from public.exercise_catalog c where l.created_by = v_ron and lower(c.name) = lower(l.name);
  insert into public.exercise_catalog_aliases (alias_key, catalog_id, alias, batch)
    select regexp_replace(lower(a.alias), '[^a-z0-9]', '', 'g'), a.catalog_id, a.alias, 'ron-merge-1'
    from (
      select c.id as catalog_id, c.name as alias from public.exercise_catalog c where c.batch = 'ron-merge-1'
      union
      select c.id, p.old_name from _cm_pairs p join public.exercise_catalog c on lower(c.name) = lower(p.final_name)
      union
      select c.id, v.alias from (values ('Sissy Squats', 'Sissy Squat'), ('Thoracic Extensions (Quadruped)', 'Thoracic Extension (Quadruped)')) as v(alias, target)
        join public.exercise_catalog c on lower(c.name) = lower(v.target)
    ) a
    where regexp_replace(lower(a.alias), '[^a-z0-9]', '', 'g') <> ''
    on conflict (alias_key) do nothing;
end
$merge$;
