-- First-run guide ("Get set up": add to home screen, turn on notifications).
-- When a client taps "Not now" the dismissal is stored here so it follows them
-- to another phone. Until this column exists the card falls back to a
-- per-device flag, so nothing breaks if the app deploys first.
alter table public.profiles
  add column if not exists guide_dismissed_at timestamptz;
