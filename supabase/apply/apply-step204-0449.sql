-- PASTE: step 204 (progression rules by the exercise's place in the program: a GZCLP lift's T1 days and T2 days each follow their own rule). Paste all of this into the Supabase SQL editor and Run. The last result is 1 row of 5 columns; every one should say true.

begin;

-- Progression rules by the exercise's place in the program, not only its name (GZCLP: each main lift is T1 on one day and T2 on another day of the same program, and the single rule per name
-- made the T1 cascade drive the T2 days too, while the T2 rule was never written).
--  1. exercise_progressions.slot (default ''): which place in the program the rule is for ('T1', 'T2', 'T3'; '' = every occurrence of the name, as before). A program can now hold one rule per
--     (program, exercise name, slot) instead of one per (program, exercise name).
--  2. group_workout_exercises.progression_slot (default ''): the place in the program this exercise holds. Its goal comes from the rule with the same name AND the same slot, counted over the
--     occurrences with the same slot only.
--  3. duplicate_program copies both new columns (the rule's slot and each exercise's progression_slot), so Assign, Duplicate and Make a template keep the T1 and T2 rules apart.
-- Every existing rule and exercise gets '' (the default), so every existing program works exactly as before. Re-running is safe.

alter table public.exercise_progressions add column if not exists slot text not null default '';
alter table public.group_workout_exercises add column if not exists progression_slot text not null default '';

alter table public.exercise_progressions drop constraint if exists exercise_progressions_slot_length;
alter table public.exercise_progressions add constraint exercise_progressions_slot_length check (char_length(slot) <= 20);
alter table public.group_workout_exercises drop constraint if exists group_workout_exercises_progression_slot_length;
alter table public.group_workout_exercises add constraint group_workout_exercises_progression_slot_length check (char_length(progression_slot) <= 20);

-- The old one-rule-per-name key (unnamed in 0009, so found by its columns) is replaced by one rule per name and slot.
do $key$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.exercise_progressions'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      ) = array['exercise_name', 'program_id']
  loop
    execute format('alter table public.exercise_progressions drop constraint %I', v_name);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.exercise_progressions'::regclass and conname = 'exercise_progressions_program_exercise_slot_key') then
    alter table public.exercise_progressions add constraint exercise_progressions_program_exercise_slot_key unique (program_id, exercise_name, slot);
  end if;
end
$key$;

-- duplicate_program (0367, set types added by 0436): each column list it copies gets the new column. Every list is found exactly once, or nothing is changed.
do $dup$
declare
  v_def text := pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure);
  v_pairs constant text[][] := array[
    -- the rule's columns (the insert's list, then the select's)
    array['program_id, group_id, exercise_name, model, config, tier_label, created_by', 'program_id, group_id, exercise_name, model, config, tier_label, slot, created_by'],
    array['select v_new, p_destination_group_id, exercise_name, model, config, tier_label, v_by', 'select v_new, p_destination_group_id, exercise_name, model, config, tier_label, slot, v_by'],
    -- the exercise's columns (the insert's list, then the values)
    array['is_slot, slot_side, slot_tier', 'is_slot, slot_side, slot_tier, progression_slot'],
    array['e.is_slot, e.slot_side, e.slot_tier', 'e.is_slot, e.slot_side, e.slot_tier, e.progression_slot']
  ];
  i int;
begin
  if position('progression_slot' in v_def) > 0 then
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

commit;

select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exercise_progressions' and column_name = 'slot' and is_nullable = 'NO' and column_default like '''''%') as rules_have_slot,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'progression_slot' and is_nullable = 'NO' and column_default like '''''%') as exercises_have_progression_slot,
  exists (select 1 from pg_constraint where conrelid = 'public.exercise_progressions'::regclass and conname = 'exercise_progressions_program_exercise_slot_key' and contype = 'u') as one_rule_per_name_and_slot,
  not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.exercise_progressions'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname) from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) = array['exercise_name', 'program_id']
  ) as old_one_rule_per_name_key_gone,
  (select count(*) from regexp_matches(pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure), 'progression_slot|tier_label, slot,', 'g')) = 4 as duplicate_copies_both;
