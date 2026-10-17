-- UNDO for step 145 (0393). Only if step 145 misbehaves. Run it only while the Release I code is not live (Add client and the invitation page use the table and functions). Pending invitations are lost.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.cancel_space_invite(uuid);
drop function if exists public.answer_space_invite(uuid, boolean);
drop table if exists public.space_invites;
-- the three extra notification types are left in the list (removing them could break rows that use them)
commit;
