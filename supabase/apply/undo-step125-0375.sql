-- UNDO for step 125 (0375). Only if step 125 misbehaves. Removes the scans and the function. The private photo bucket and any photos already in it are left where they are (nobody can read them without the policies).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.save_body_scan(uuid, uuid, jsonb, text, boolean);
drop policy if exists "inbody_scans_storage_select" on storage.objects;
drop policy if exists "inbody_scans_storage_insert" on storage.objects;
drop policy if exists "inbody_scans_storage_delete" on storage.objects;
drop table if exists public.body_scans;
commit;
