-- UNDO for step 127 (0377). Only if step 127 misbehaves. Removes the rule; nothing else changes.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.exercise_library drop constraint if exists exercise_library_name_not_digits;
alter table public.exercise_aliases drop constraint if exists exercise_aliases_target_not_digits;
commit;
