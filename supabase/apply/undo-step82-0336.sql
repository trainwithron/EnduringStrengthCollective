-- UNDO for step 82 (0336). Only if step 82 misbehaves. Removes the column (the card goes back to being remembered by each browser only).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.profiles drop column if exists terminology_asked_at;
commit;
