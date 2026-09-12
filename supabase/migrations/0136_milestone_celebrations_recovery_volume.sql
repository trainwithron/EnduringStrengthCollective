-- Milestone Celebrations, piece B — "recovering better while lifting
-- heavier." Reuses milestone_events (widen the type check) rather than
-- a new table — same dedupe/cooldown ledger, different milestone_type.
alter table public.milestone_events drop constraint milestone_events_milestone_type_check;
alter table public.milestone_events add constraint milestone_events_milestone_type_check
  check (milestone_type in ('reverse_diet', 'recovery_volume'));
