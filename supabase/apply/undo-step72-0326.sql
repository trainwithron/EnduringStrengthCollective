-- UNDO for step 72 (0326). Only if step 72 misbehaves. Removes the two conversation tables (and what was said in them) and the invitation columns. Standing preferences the coach confirmed are not touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.coach_conversation_messages;
drop table if exists public.coach_conversations;
alter table public.coach_learning_settings drop constraint if exists coach_learning_settings_invite_state_check;
alter table public.coach_learning_settings drop column if exists invite_reminders;
alter table public.coach_learning_settings drop column if exists invite_shown_at;
alter table public.coach_learning_settings drop column if exists invite_state;
commit;
