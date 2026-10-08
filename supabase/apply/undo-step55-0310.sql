-- UNDO for step 55 (0310). Only if step 55 misbehaves. Removes the column and any coach names already saved in it (the exercises themselves and all history are untouched; they simply show their real names again).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.group_workout_exercises drop constraint if exists group_workout_exercises_display_name_len;
alter table public.group_workout_exercises drop column if exists display_name;
commit;
