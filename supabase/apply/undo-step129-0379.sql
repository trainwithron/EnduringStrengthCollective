-- UNDO for step 129 (0379). Only if step 129 misbehaves. Removes the two rules; nothing else changes.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.group_workout_exercises drop constraint if exists group_workout_exercises_name_not_digits;
alter table public.session_exercises drop constraint if exists session_exercises_name_not_digits;
commit;
