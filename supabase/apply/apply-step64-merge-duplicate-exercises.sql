-- STEP 64: merge Coach Ron's duplicate exercises into one entry each (13 duplicates into 12 survivors, Ron's library only; every set and log row is kept; undoable)
--
-- !! A one-time data change for Coach Ron's library ONLY. It rewrites the exercise name on his programs, his clients' sessions and records, his patterns, aliases and tags, saves the old duplicate names as aliases of the survivor, and deletes the duplicate library rows. Every changed or deleted row is saved first (exercise_merge_log, exercise_merge_deleted), and the undo file puts it all back. It refuses by itself if any of the 25 library entries is missing or if a name would clash.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Each duplicate (for example Deadlift and Conventional Deadlifts) is now Conventional Deadlift everywhere in Ron's programs and history, typing the old name still finds it (it is an alias), and the library lists each exercise once. To see how many rows changed per table: select tbl, col, count(*) from public.exercise_merge_log group by tbl, col order by tbl, col;
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.exercise_merge_log') is null)) then
    raise exception 'Step 64 (merge-duplicate-exercises) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- merge-duplicate-exercises: one-time data change
-- ====================================================================================================

-- Release V: merges the duplicate exercises in Coach Ron's library (and ONLY his: created_by 136394ed-f108-4283-bcb7-310a1ac6cbc8) into one entry each, so "Deadlift", "Conventional
-- Deadlift" and "Conventional Deadlifts" become one. 13 duplicates go into 12 survivors (the one with the video; where neither has one, the singular). For each duplicate the
-- exercise name is rewritten to the survivor's wherever it is stored as text in Ron's world (his programs, his clients' sessions and records, his patterns, his aliases, his
-- tags), every set and log row is kept, the duplicate's name is saved as an alias of the survivor so typing it again finds the survivor, and the duplicate's library row is deleted.
-- Nothing belonging to any other coach is touched. All or nothing: any problem (a missing entry, a name clash in a table with a uniqueness rule) stops everything with nothing kept.
-- Every row changed or deleted is first written to exercise_merge_log / exercise_merge_deleted (server-only), which is what the undo file reads. After running, this shows how many
-- rows changed per table:  select tbl, col, count(*) from public.exercise_merge_log group by tbl, col order by tbl, col;

create table public.exercise_merge_log (
  id bigserial primary key,
  tbl text not null,
  row_id text not null,
  col text not null,
  old_value jsonb,
  new_value jsonb,
  merged_at timestamptz not null default now()
);
create table public.exercise_merge_deleted (
  id bigserial primary key,
  tbl text not null,
  row jsonb not null,
  merged_at timestamptz not null default now()
);
alter table public.exercise_merge_log enable row level security;
alter table public.exercise_merge_deleted enable row level security;
revoke all on public.exercise_merge_log from anon, authenticated;
revoke all on public.exercise_merge_deleted from anon, authenticated;

do $merge$
declare
  v_ron constant uuid := '136394ed-f108-4283-bcb7-310a1ac6cbc8';
  -- loser, survivor, loser, survivor, ...
  v_pairs constant text[] := array[
    'Deadlift', 'Conventional Deadlift',
    'Conventional Deadlifts', 'Conventional Deadlift',
    'Band Pull-Apart', 'Band Pull Apart',
    'Chin Ups', 'Chin-Up',
    'Dips', 'Dip',
    'Dumbbell Lateral Raises', 'Dumbbell Lateral Raise',
    'Farmer''s Carry', 'Farmers Carry',
    'Lat Pull Down', 'Lat Pulldown',
    'Shoulder CARS', 'Shoulder CARs',
    'Sit Ups', 'Sit-Up',
    'Step Ups', 'Step Up',
    'Bulgarian Split Squats', 'Bulgarian Split Squat',
    'Walking Lunges', 'Walking Lunge'
  ];
  i int;
  v_loser text;
  v_survivor text;
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

  for i in 1 .. array_length(v_pairs, 1) / 2 loop
    v_loser := v_pairs[2 * i - 1];
    v_survivor := v_pairs[2 * i];

    if not exists (select 1 from public.exercise_library where created_by = v_ron and name = v_loser) then
      raise exception 'Ron''s library has no "%" to merge, so nothing was merged.', v_loser;
    end if;
    if not exists (select 1 from public.exercise_library where created_by = v_ron and name = v_survivor) then
      raise exception 'Ron''s library has no "%" to merge into, so nothing was merged.', v_survivor;
    end if;

    -- program exercises
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'group_workout_exercises', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.group_workout_exercises x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.group_workout_exercises set exercise_name = v_survivor
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- exercises inside logged and live sessions
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'session_exercises', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.session_exercises x join public.athlete_sessions s on s.id = x.session_id
      where x.exercise_name = v_loser and s.group_id in (select group_id from _ron_groups);
    update public.session_exercises x set exercise_name = v_survivor
      from public.athlete_sessions s
      where s.id = x.session_id and x.exercise_name = v_loser and s.group_id in (select group_id from _ron_groups);

    -- per-client swaps
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'athlete_exercise_overrides', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.athlete_exercise_overrides x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.athlete_exercise_overrides set exercise_name = v_survivor
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- progression rules (one per program and exercise: where a program already has the survivor's, the survivor's is kept)
    insert into public.exercise_merge_deleted (tbl, row)
      select 'exercise_progressions', to_jsonb(x) from public.exercise_progressions x
      where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups)
        and exists (select 1 from public.exercise_progressions s where s.program_id = x.program_id and s.exercise_name = v_survivor);
    delete from public.exercise_progressions x
      where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups)
        and exists (select 1 from public.exercise_progressions s where s.program_id = x.program_id and s.exercise_name = v_survivor);
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'exercise_progressions', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.exercise_progressions x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.exercise_progressions set exercise_name = v_survivor
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- records (a clash with the survivor's current record stops everything)
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'exercise_records', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.exercise_records x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.exercise_records set exercise_name = v_survivor
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- game scores
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'game_score_entries', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.game_score_entries x where x.exercise_name = v_loser and x.group_id in (select group_id from _ron_groups);
    update public.game_score_entries set exercise_name = v_survivor
      where exercise_name = v_loser and group_id in (select group_id from _ron_groups);

    -- Ron's movement patterns and tiers (where a pattern already has the survivor, the survivor's row and tier are kept)
    insert into public.exercise_merge_deleted (tbl, row)
      select 'movement_pattern_exercises', to_jsonb(x) from public.movement_pattern_exercises x
      join public.movement_patterns p on p.id = x.movement_pattern_id
      where x.exercise_name = v_loser and p.created_by = v_ron
        and exists (select 1 from public.movement_pattern_exercises s where s.movement_pattern_id = x.movement_pattern_id and s.exercise_name = v_survivor);
    delete from public.movement_pattern_exercises x using public.movement_patterns p
      where p.id = x.movement_pattern_id and x.exercise_name = v_loser and p.created_by = v_ron
        and exists (select 1 from public.movement_pattern_exercises s where s.movement_pattern_id = x.movement_pattern_id and s.exercise_name = v_survivor);
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'movement_pattern_exercises', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.movement_pattern_exercises x join public.movement_patterns p on p.id = x.movement_pattern_id
      where x.exercise_name = v_loser and p.created_by = v_ron;
    update public.movement_pattern_exercises x set exercise_name = v_survivor
      from public.movement_patterns p
      where p.id = x.movement_pattern_id and x.exercise_name = v_loser and p.created_by = v_ron;

    -- Ron's tags on the exercise (a clash stops everything)
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'exercise_biomech_tags', x.id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.exercise_biomech_tags x where x.exercise_name = v_loser and x.created_by = v_ron;
    update public.exercise_biomech_tags set exercise_name = v_survivor where exercise_name = v_loser and created_by = v_ron;

    -- his clients' training maxes and load ratios (a clash stops everything)
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'athlete_training_maxes', x.athlete_id::text, 'exercise_name', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.athlete_training_maxes x where x.exercise_name = v_loser and x.athlete_id in (select profile_id from _ron_athletes);
    update public.athlete_training_maxes set exercise_name = v_survivor
      where exercise_name = v_loser and athlete_id in (select profile_id from _ron_athletes);
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'athlete_equipment_load_ratios', x.id::text, 'exercise_name_a', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.athlete_equipment_load_ratios x where x.exercise_name_a = v_loser and x.athlete_id in (select profile_id from _ron_athletes);
    update public.athlete_equipment_load_ratios set exercise_name_a = v_survivor
      where exercise_name_a = v_loser and athlete_id in (select profile_id from _ron_athletes);
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'athlete_equipment_load_ratios', x.id::text, 'exercise_name_b', to_jsonb(v_loser), to_jsonb(v_survivor)
      from public.athlete_equipment_load_ratios x where x.exercise_name_b = v_loser and x.athlete_id in (select profile_id from _ron_athletes);
    update public.athlete_equipment_load_ratios set exercise_name_b = v_survivor
      where exercise_name_b = v_loser and athlete_id in (select profile_id from _ron_athletes);

    -- PR lists on logged workouts and exercises shared on posts
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'workout_logs', x.id::text, 'new_prs', to_jsonb(x.new_prs), to_jsonb(array_replace(x.new_prs, v_loser, v_survivor))
      from public.workout_logs x where x.group_id in (select group_id from _ron_groups) and v_loser = any (x.new_prs);
    update public.workout_logs set new_prs = array_replace(new_prs, v_loser, v_survivor)
      where group_id in (select group_id from _ron_groups) and v_loser = any (new_prs);
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'posts', x.id::text, 'shared_exercise_names', to_jsonb(x.shared_exercise_names), to_jsonb(array_replace(x.shared_exercise_names, v_loser, v_survivor))
      from public.posts x where x.group_id in (select group_id from _ron_groups) and v_loser = any (x.shared_exercise_names);
    update public.posts set shared_exercise_names = array_replace(shared_exercise_names, v_loser, v_survivor)
      where group_id in (select group_id from _ron_groups) and v_loser = any (shared_exercise_names);

    -- Ron's aliases: the ones pointing at the duplicate now point at the survivor, and the duplicate's own name becomes an alias of the survivor
    insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value)
      select 'exercise_aliases', x.id::text, 'exercise_name', to_jsonb(x.exercise_name), to_jsonb(v_survivor)
      from public.exercise_aliases x
      where x.coach_id = v_ron and (x.exercise_name = v_loser or (x.raw_name = v_loser and x.exercise_name <> v_survivor));
    update public.exercise_aliases set exercise_name = v_survivor
      where coach_id = v_ron and (exercise_name = v_loser or (raw_name = v_loser and exercise_name <> v_survivor));
    v_new_id := null;
    insert into public.exercise_aliases (coach_id, raw_name, exercise_name) values (v_ron, v_loser, v_survivor)
      on conflict (coach_id, raw_name) do nothing returning id into v_new_id;
    if v_new_id is not null then
      insert into public.exercise_merge_log (tbl, row_id, col, old_value, new_value) values ('exercise_aliases', v_new_id::text, '__inserted', null, to_jsonb(v_loser));
    end if;

    -- finally the duplicate's library row
    insert into public.exercise_merge_deleted (tbl, row)
      select 'exercise_library', to_jsonb(l) from public.exercise_library l where l.created_by = v_ron and l.name = v_loser;
    delete from public.exercise_library where created_by = v_ron and name = v_loser;
  end loop;
end
$merge$;

commit;
