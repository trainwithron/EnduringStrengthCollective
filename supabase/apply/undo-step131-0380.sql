-- UNDO for step 131 (0380). Only if step 131 misbehaves. Removes the rule; nothing else changes.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.workouts drop constraint if exists workouts_program_week_day_key;
commit;
