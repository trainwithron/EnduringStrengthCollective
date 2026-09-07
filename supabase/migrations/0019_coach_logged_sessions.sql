-- ============================================================================
-- Marks a session (and its resulting workout_logs summary) as logged by the
-- coach in person, rather than by the athlete themselves — surfaced as a
-- small badge so a client reviewing their own history later can tell the
-- difference, instead of it silently looking like their own entry.
-- ============================================================================

alter table public.athlete_sessions
  add column logged_by_coach boolean not null default false;

alter table public.workout_logs
  add column logged_by_coach boolean not null default false;
