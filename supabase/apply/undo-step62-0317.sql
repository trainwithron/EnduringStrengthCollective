-- UNDO for step 62 (0317). Only if step 62 misbehaves. Removes the record and the column; clients already added to a group stay members of it.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.package_group_access;
alter table public.coach_packages drop column if exists group_access_group_id;
commit;
