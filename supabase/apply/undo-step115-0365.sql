-- UNDO for step 115 (0365). Only if step 115 misbehaves. Removes the four new empty columns (safe until a unilateral mark or a slot has been saved; those marks would be lost).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.group_memberships drop column if exists training_level;
alter table public.group_workout_exercises drop column if exists slot_tier, drop column if exists slot_side, drop column if exists is_slot;
alter table public.movement_pattern_exercises drop column if exists is_unilateral;
commit;
