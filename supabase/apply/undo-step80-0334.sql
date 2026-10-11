-- UNDO for step 80 (0334). Only if step 80 misbehaves. Removes the new column (every client's name shows on shared pictures again, whatever they chose).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.profiles drop column if exists show_name_on_share;
commit;
