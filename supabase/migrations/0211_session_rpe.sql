-- Post-session RPE (session_rpe_and_load_idea / half-finished-ideas-full-audit
-- item #18) — a single one-tap post-workout rating (Foster's session-RPE
-- construct: how hard did the WHOLE session feel, 1-10), not an average of
-- per-set RPE (which already exists separately on group_workout_exercise_sets/
-- set_logs for training-max calculations). Nullable and additive — every
-- existing session simply has no rating, same as every other optional
-- self-report field in this app (wellness_checkins, body_weight_logs).
alter table public.athlete_sessions
  add column session_rpe smallint check (session_rpe between 1 and 10);
