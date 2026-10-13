-- UNDO for step 110 (0361). Only if step 110 misbehaves. Removes the catalog tables and the link column (they are empty or only hold names).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.exercise_library drop column if exists catalog_id;
drop table if exists public.exercise_catalog_aliases;
drop table if exists public.exercise_catalog;
commit;
