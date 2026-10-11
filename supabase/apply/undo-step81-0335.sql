-- UNDO for step 81 (0335). Only if step 81 misbehaves. Removes the new function (assigning then always makes a copy, as before). Nothing already assigned changes.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.assign_program_to_client(uuid, uuid, uuid, text, date);
commit;
