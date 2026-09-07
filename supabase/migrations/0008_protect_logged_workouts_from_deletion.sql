-- ============================================================================
-- BUG FIX: deleting a workout template was silently cascading away athlete
-- history. athlete_sessions.workout_id was ON DELETE CASCADE, and because
-- workout_logs.session_id is ALSO ON DELETE CASCADE (from athlete_sessions),
-- Postgres removed the workout_logs rows via that path BEFORE ever checking
-- the (intentionally un-cascaded) workout_logs.workout_id restrict — so the
-- restrict never had anything left to block. Net effect: deleting a workout
-- silently destroyed every athlete's logged sets and rollups for it.
--
-- Fix: athlete_sessions.workout_id becomes ON DELETE RESTRICT. Once any
-- athlete has started a session against a workout, that workout can no
-- longer be hard-deleted at all — Postgres refuses before any cascade
-- begins. A coach can still delete a workout nobody has ever started.
-- ============================================================================
alter table public.athlete_sessions
  drop constraint athlete_sessions_workout_id_fkey,
  add constraint athlete_sessions_workout_id_fkey
    foreign key (workout_id) references public.workouts(id) on delete restrict;
