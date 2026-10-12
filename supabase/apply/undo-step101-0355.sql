-- UNDO for step 101 (0355). Only if step 101 misbehaves. Removes the assessments table (and so every assessment saved) and the storage rules; uploaded files stay in storage until removed there.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "client_assessments_files_delete" on storage.objects;
drop policy if exists "client_assessments_files_insert" on storage.objects;
drop policy if exists "client_assessments_files_select" on storage.objects;
drop table if exists public.client_assessments;
commit;
