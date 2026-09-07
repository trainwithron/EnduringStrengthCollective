-- ============================================================================
-- PATCH: Track which exercises hit a PR in a given workout
-- ============================================================================
alter table public.workout_logs
  add column new_prs text[] not null default '{}';
