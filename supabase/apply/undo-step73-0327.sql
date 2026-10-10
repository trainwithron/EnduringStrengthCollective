-- UNDO for step 73 (0327). Only if step 73 misbehaves. Removes the table (and any custom wording coaches saved); every coach goes back to the default message.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.coach_message_templates;
commit;
