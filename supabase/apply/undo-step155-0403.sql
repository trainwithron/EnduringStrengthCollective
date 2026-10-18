-- UNDO for step 155 (0403). Only if step 155 misbehaves. Removes the trigger; people it already flagged stay flagged (they still finish the form once).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists group_memberships_require_intake on public.group_memberships;
drop function if exists public.require_intake_for_new_client();
commit;
