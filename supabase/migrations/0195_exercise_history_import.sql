-- Coach-facing exercise-history upload during client onboarding
-- (coach_onboarding_history_ingestion_scoping_sept19.md), Phase 1: manual
-- entry + CSV import (photo OCR deliberately held for a later phase).
--
-- No new tables. Checked first (per the task's own explicit warning) —
-- no source/is_historical-type column exists anywhere on set_logs today.
-- Both new flags are additive and default false, so every existing row
-- and every existing query/RPC (complete_workout_session, the training-
-- max trigger, "last time lifted" lookups) behaves exactly as it does
-- today; a historical entry is written directly into the same
-- athlete_sessions -> session_exercises -> set_logs tables real logging
-- already uses, flagged so it's never confused with a live session.
alter table public.athlete_sessions
  add column is_historical boolean not null default false;

alter table public.set_logs
  add column is_historical boolean not null default false;

-- Lets a coach grant one client a one-time link into the same uploader
-- UI, per the locked design's #2 ("optional one-time client access to
-- the same uploader"). Reuses the existing memberships_update_coach RLS
-- policy (already lets a coach update any membership row in their own
-- group) — no new policy needed. Defaults false: a client never sees a
-- self-entry option until their coach deliberately turns it on.
alter table public.group_memberships
  add column history_import_enabled boolean not null default false;
