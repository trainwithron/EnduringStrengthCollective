-- UNDO for step 162 (0410). Only if step 162 misbehaves. Stops the support notices; threads work as before.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists support_messages_notify on public.support_messages;
drop function if exists public.notify_on_support_message();
-- the extra notification kind is left in the list (removing it could break rows that use it)
commit;
