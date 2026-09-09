-- The feed's leaderboard card was a one-shot server fetch sitting above
-- an otherwise-live feed — nothing kept it in sync as new workouts were
-- logged. A client-side subscription needs workout_logs added to the
-- realtime publication (posts/comments/reactions already are, from the
-- feed's own existing live-update work) — without this, a
-- postgres_changes subscription on this table silently never fires.
alter publication supabase_realtime add table public.workout_logs;
