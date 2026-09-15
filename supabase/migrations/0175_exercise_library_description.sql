-- Team warm-up games (Jochum Ball, Spikeball reaction warm-up, Sapien
-- Ball, "Keep It Up") need a real place to hold rules/instructions text,
-- attribution included — exercise_library has no free-text field at all
-- today (name/video_path/youtube_url/category/equipment_type only).
-- Nullable, purely additive: every one of the 256+ existing exercises
-- simply has no description, same as they have no video today.
alter table public.exercise_library
  add column description text;
