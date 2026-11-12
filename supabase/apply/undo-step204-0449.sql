-- UNDO step 204 (progression rules by the exercise's place in the program). Back to one rule per exercise name: where a program has rules for several places of one exercise (a GZCLP lift's T1
-- and T2), only one is kept (the one for every occurrence if there is one, else T1, else the first by place), the others are deleted, and every exercise follows its name's rule again as before.
-- No exercise, set, logged session or program is deleted. Duplicate stops copying the two columns.
begin;

delete from public.exercise_progressions r
using public.exercise_progressions keep
where keep.program_id = r.program_id
  and keep.exercise_name = r.exercise_name
  and keep.id <> r.id
  and (case when keep.slot = '' then 0 when keep.slot = 'T1' then 1 else 2 end, keep.slot, keep.id::text)
    < (case when r.slot = '' then 0 when r.slot = 'T1' then 1 else 2 end, r.slot, r.id::text);

do $dup$
declare
  v_def text := pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure);
begin
  if position('progression_slot' in v_def) = 0 then
    return; -- already undone
  end if;
  v_def := replace(v_def, 'program_id, group_id, exercise_name, model, config, tier_label, slot, created_by', 'program_id, group_id, exercise_name, model, config, tier_label, created_by');
  v_def := replace(v_def, 'select v_new, p_destination_group_id, exercise_name, model, config, tier_label, slot, v_by', 'select v_new, p_destination_group_id, exercise_name, model, config, tier_label, v_by');
  v_def := replace(v_def, 'is_slot, slot_side, slot_tier, progression_slot', 'is_slot, slot_side, slot_tier');
  v_def := replace(v_def, 'e.is_slot, e.slot_side, e.slot_tier, e.progression_slot', 'e.is_slot, e.slot_side, e.slot_tier');
  execute v_def;
end
$dup$;

alter table public.exercise_progressions drop constraint if exists exercise_progressions_program_exercise_slot_key;
alter table public.exercise_progressions drop constraint if exists exercise_progressions_slot_length;
alter table public.exercise_progressions drop column if exists slot;
alter table public.group_workout_exercises drop constraint if exists group_workout_exercises_progression_slot_length;
alter table public.group_workout_exercises drop column if exists progression_slot;
alter table public.exercise_progressions drop constraint if exists exercise_progressions_program_id_exercise_name_key;
alter table public.exercise_progressions add constraint exercise_progressions_program_id_exercise_name_key unique (program_id, exercise_name);

commit;
