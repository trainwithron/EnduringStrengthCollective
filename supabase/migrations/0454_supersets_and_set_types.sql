-- Supersets and circuits, and the set types the coach chooses in the builder reaching the client's workout (Ron, Nov 20: B1, B2).
--  1. group_workout_exercises.superset_next (default false): this exercise is done back to back with the NEXT one in the day (a superset is two linked exercises, a circuit three or more).
--     The builder labels them 1a, 1b, 1c; the client's workout keeps them together (one set of each, then the rest). Every existing exercise gets false, so every program works as before.
--  2. duplicate_program copies it (Assign, Duplicate and Make a template keep the links). The LIVE definition is changed in place: each column list it copies is found exactly once, or nothing is.
--  3. start_workout_session copies each programmed set's set_type (warm-up, working, AMRAP, back-off, drop) into the client's sets. Before this every set started as a working set whatever the
--     coach chose. The LIVE definition is changed in place the same way. A set with no type, or one the database does not know, starts as a working set, as before.
-- Re-running is safe.

alter table public.group_workout_exercises add column if not exists superset_next boolean not null default false;

do $dup$
declare
  v_def text := pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure);
  v_pairs constant text[][] := array[
    array['is_slot, slot_side, slot_tier, progression_slot', 'is_slot, slot_side, slot_tier, progression_slot, superset_next'],
    array['e.is_slot, e.slot_side, e.slot_tier, e.progression_slot', 'e.is_slot, e.slot_side, e.slot_tier, e.progression_slot, e.superset_next']
  ];
  i int;
begin
  if position('superset_next' in v_def) > 0 then
    return; -- already changed (re-run)
  end if;
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'duplicate_program does not hold "%" exactly once; NOTHING was changed.', v_pairs[i][1];
    end if;
  end loop;
  for i in 1 .. array_length(v_pairs, 1) loop
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;
end
$dup$;

do $start$
declare
  v_def text := pg_get_functiondef('public.start_workout_session(uuid, uuid, uuid, boolean, uuid, boolean, uuid, jsonb)'::regprocedure);
  v_pairs constant text[][] := array[
    array['insert into public.set_logs (session_exercise_id, set_order, weight, reps)', 'insert into public.set_logs (session_exercise_id, set_order, weight, reps, set_type)'],
    array['nullif(st ->> ''reps'', '''')::int', 'nullif(st ->> ''reps'', '''')::int, case when st ->> ''set_type'' in (''warmup'', ''working'', ''amrap'', ''backoff'', ''drop'') then st ->> ''set_type'' else ''working'' end']
  ];
  i int;
begin
  if position('set_type' in v_def) > 0 then
    return; -- already changed (re-run)
  end if;
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'start_workout_session does not hold "%" exactly once; NOTHING was changed.', v_pairs[i][1];
    end if;
  end loop;
  for i in 1 .. array_length(v_pairs, 1) loop
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;
end
$start$;
