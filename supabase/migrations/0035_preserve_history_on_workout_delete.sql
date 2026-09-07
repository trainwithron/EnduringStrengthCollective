-- Deleting a workout template should always succeed and should never
-- touch an athlete's actual history. Previously: athlete_sessions.workout_id
-- was ON DELETE RESTRICT (blocking the delete entirely once anyone had
-- started that workout), and workout_logs.workout_id was ON DELETE CASCADE
-- (which would have silently destroyed the completed log — total volume,
-- sets, PRs, everything — the moment the restrict was ever lifted).
-- Neither preserves both "coach can always delete" and "history survives."
--
-- Fix: both become ON DELETE SET NULL. The workout template can go away
-- at any time; the log/session rows survive with a null workout_id,
-- keeping every stat intact. The one place that joins workout_logs to
-- workouts for a title (the client profile page) already falls back to
-- "Workout" when that join comes back empty.
alter table public.workout_logs alter column workout_id drop not null;
alter table public.athlete_sessions alter column workout_id drop not null;

alter table public.workout_logs
  drop constraint workout_logs_workout_id_fkey,
  add constraint workout_logs_workout_id_fkey
    foreign key (workout_id) references public.workouts(id) on delete set null;

alter table public.athlete_sessions
  drop constraint athlete_sessions_workout_id_fkey,
  add constraint athlete_sessions_workout_id_fkey
    foreign key (workout_id) references public.workouts(id) on delete set null;
