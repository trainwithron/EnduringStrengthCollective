-- UNDO for step 173 (0421). Only if step 173 misbehaves, and only while the Release TC3 invitation code is not live (the code needs the table). Links already sent stop working.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.coach_join_links;
commit;
