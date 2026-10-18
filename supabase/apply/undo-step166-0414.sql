-- UNDO for step 166 (0414). Only if step 166 misbehaves. Run it only while the Release CS1 code is not live; any coach's choice stored in the column is lost and every group goes back to its default.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.groups drop column if exists post_workout_cards;
commit;
