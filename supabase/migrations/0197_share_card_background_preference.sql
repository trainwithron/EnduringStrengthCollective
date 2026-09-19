-- share_card_backgrounds_expansion_scoping_sept19.md — the stock
-- scenic-background library grows from 2 scenes to a real set (see
-- lib/scenic-backgrounds.ts), and picking one becomes a per-athlete
-- preference instead of the org-wide default_rotation/custom toggle
-- (organizations.workout_card_background_mode/url, migration 0165)
-- picking for everyone at once. That org-level setting is untouched —
-- it's still what a client without a personal pick falls back to.
--
-- No check constraint against the scenic-key list on purpose: the
-- stock set is expected to keep growing, and a stale key left over
-- from a since-removed scene should fall back to auto-rotation
-- gracefully (handled in lib/scenic-backgrounds.ts), not break a
-- write or need a migration every time the set changes.
alter table public.profiles
  add column preferred_share_background text;
