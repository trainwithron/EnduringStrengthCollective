-- The notification bell was a one-shot server fetch with no live update
-- at all — a mention, reply, or program/macro assignment landing while
-- the app was open never touched the badge count until a full reload.
-- Needs the same realtime-publication fix already applied once for
-- workout_logs (0097): posts/comments/reactions/workout_logs are in the
-- publication, notifications never was, so a postgres_changes
-- subscription on it would silently never fire.
alter publication supabase_realtime add table public.notifications;
