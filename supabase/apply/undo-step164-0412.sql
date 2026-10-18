-- UNDO for step 164 (0412). Only if step 164 misbehaves. Run it only while the Release T1 code is not live. Download my data then falls back to its short list.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.export_my_data_table(text, text, integer, integer);
drop function if exists public.export_my_data_tables();
-- the empty account-exports bucket is left in place (removing a bucket that holds files fails)
commit;
