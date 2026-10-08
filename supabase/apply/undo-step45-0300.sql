-- UNDO for step 45 (0300). Only if step 45 misbehaves. Removes the portions table, the batch record and the new optional columns on food_log_entries (the detail of searched foods logged since is lost; the calories and macros of those entries stay). Nothing else is touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.food_log_entries drop constraint if exists food_log_entries_amounts_sane;
alter table public.food_log_entries drop constraint if exists food_log_entries_detail_check;
alter table public.food_log_entries drop constraint if exists food_log_entries_food_source_check;
alter table public.food_log_entries drop column if exists food_source, drop column if exists fdc_id, drop column if exists amount_g, drop column if exists serving_label, drop column if exists serving_qty, drop column if exists nutrients, drop column if exists barcode;
drop table if exists public.usda_load_batches;
drop table if exists public.usda_food_portions;
commit;
