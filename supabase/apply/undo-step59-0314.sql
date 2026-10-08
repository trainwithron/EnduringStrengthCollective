-- UNDO for step 59 (0314). Only if step 59 misbehaves. Removes the table; the switch then works on each device separately again, as before.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.client_ui_settings;
commit;
