-- UNDO for step 60 (0315). Only if step 60 misbehaves. Removes the away setting, its two functions and the marker column; messages already sent stay as ordinary messages.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists direct_messages_send_away_reply on public.direct_messages;
drop trigger if exists direct_messages_guard_auto_reply on public.direct_messages;
drop function if exists public.send_away_reply();
drop function if exists public.guard_direct_message_auto_reply();
drop table if exists public.coach_away_replies;
alter table public.direct_messages drop column if exists auto_reply;
commit;
