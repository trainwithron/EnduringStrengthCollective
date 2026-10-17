-- UNDO for step 142 (0390). Only if step 142 misbehaves. Run it only while the Release H code is not live (the import and the History page read and write the column). Removes the column; the imported workouts stay, they just can no longer be removed as one batch.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop index if exists public.athlete_sessions_import_batch_idx;
alter table public.athlete_sessions drop column if exists import_batch_id;
commit;
