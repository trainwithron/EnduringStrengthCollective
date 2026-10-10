-- UNDO for step 71 (0325). Only if step 71 misbehaves. Removes the four learning tables (and what they noted) and the snapshot column. The coach's standing preferences are not touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.coach_learning_settings;
drop table if exists public.coach_learned_rules;
drop table if exists public.coach_edit_events;
drop table if exists public.coach_program_signoffs;
alter table public.programs drop column if exists ai_snapshot;
commit;
