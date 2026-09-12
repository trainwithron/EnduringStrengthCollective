-- Phase 3 of the gamified-logging thread (custom_shape_theming_idea.md)
-- needs to know what equipment an exercise actually uses, so the
-- per-set visual can be intuitive to it (barbell -> plate math,
-- kettlebell -> scales in size, dumbbell -> number on the head) instead
-- of one fixed shape applied uniformly. Nullable, same
-- suggest-and-confirm classifier pattern already used for `category`
-- (lib/exercise-category-classifier.ts) — never silently auto-assigned.
alter table public.exercise_library
  add column equipment_type text
    check (equipment_type in ('barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'band', 'bodyweight'));
