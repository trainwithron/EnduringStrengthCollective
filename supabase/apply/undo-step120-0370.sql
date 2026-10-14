-- UNDO for step 120 (0370). Only if step 120 misbehaves. Removes the one-week hides and the No macros setting (every nudge then shows as it did before).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.attention_snoozes;
alter table public.group_memberships drop column if exists coach_sets_macros;
commit;
