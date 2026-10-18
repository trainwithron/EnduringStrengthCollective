-- UNDO for step 150 (0398). Only if step 150 misbehaves. Run it only while the Release S1 code is not live (changing a client's sign-in email reads this table). A change still waiting for confirmation is simply dropped.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.pending_email_changes;
-- the two extra notification kinds are left in the list (removing them could break rows that use them)
commit;
