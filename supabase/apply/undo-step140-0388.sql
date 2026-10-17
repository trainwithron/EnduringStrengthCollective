-- UNDO for step 140 (0388). Only if step 140 misbehaves. Switches the guard off again (the browser may then write the completion columns, as before Release D).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists client_intake_guard_completion on public.client_intake;
commit;
