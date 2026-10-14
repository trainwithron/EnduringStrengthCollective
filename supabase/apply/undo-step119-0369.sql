-- UNDO for step 119 (0369). Only if step 119 misbehaves. Removes the new rules, clauses and correction events (the old swap rules and their preference lines are kept exactly as they were).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
delete from public.coach_learned_rules where kind <> 'swap';
alter table public.coach_learned_rules drop constraint if exists coach_learned_rules_scope_check;
alter table public.coach_learned_rules drop column if exists when_keys, drop column if exists then_text, drop column if exists scope, drop column if exists client_id, drop column if exists source, drop column if exists confirmations;
alter table public.coach_learned_rules drop constraint if exists coach_learned_rules_kind_check;
alter table public.coach_learned_rules add constraint coach_learned_rules_kind_check check (kind in ('swap'));
alter table public.coach_learned_rules alter column from_name set not null;
alter table public.coach_learned_rules alter column to_name set not null;
delete from public.coach_edit_events where kind = 'correction';
alter table public.coach_edit_events drop constraint if exists coach_edit_events_kind_check;
alter table public.coach_edit_events add constraint coach_edit_events_kind_check check (kind in ('swap', 'sets_reps', 'order', 'removed', 'added'));
alter table public.coach_edit_events drop column if exists context, drop column if exists why, drop column if exists reason_tags, drop column if exists source;
alter table public.coach_learning_settings drop column if exists intro_seen_at;
drop table if exists public.client_clauses;
commit;
