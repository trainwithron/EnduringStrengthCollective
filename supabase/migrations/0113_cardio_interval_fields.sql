-- Two new tracked fields for cardio/interval programming, following the
-- exact existing column convention (one nullable column per field, on
-- both the target table and the actual-logged table). target_pace is
-- free text, same convention as target_tempo — holds a real pace
-- ("8:30/mi"), a plain effort label ("easy"), or an RPE-per-mile note.
alter table public.group_workout_exercise_sets
  add column target_rest_seconds numeric,
  add column target_pace text;

alter table public.set_logs
  add column rest_seconds numeric,
  add column pace text;
