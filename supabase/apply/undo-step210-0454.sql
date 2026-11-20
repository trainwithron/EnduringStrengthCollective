-- UNDO: step 210 (supersets and set types). Puts duplicate_program and start_workout_session back as they were (each change found exactly once in the live definition, or nothing is changed),
-- then removes the superset column (every link between exercises goes; the exercises stay). Sets already started keep the type they started with.

begin;

do $dup$
declare
  v_def text := pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure);
  v_pairs constant text[][] := array[
    array['is_slot, slot_side, slot_tier, progression_slot, superset_next', 'is_slot, slot_side, slot_tier, progression_slot'],
    array['e.is_slot, e.slot_side, e.slot_tier, e.progression_slot, e.superset_next', 'e.is_slot, e.slot_side, e.slot_tier, e.progression_slot']
  ];
  i int;
begin
  if position('superset_next' in v_def) = 0 then
    return; -- already undone
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
    array['insert into public.set_logs (session_exercise_id, set_order, weight, reps, set_type)', 'insert into public.set_logs (session_exercise_id, set_order, weight, reps)'],
    array[', case when st ->> ''set_type'' in (''warmup'', ''working'', ''amrap'', ''backoff'', ''drop'') then st ->> ''set_type'' else ''working'' end', '']
  ];
  i int;
begin
  if position('set_type' in v_def) = 0 then
    return; -- already undone
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

alter table public.group_workout_exercises drop column if exists superset_next;

commit;
