-- Movement Pattern Ladders seed set (approved 2026-09-14) — two real
-- schema gaps the artifact's own audit found before any of the 110
-- exercises can be written:
--
-- 1. exercise_library.category was still on the old 7-value set (Push,
--    Pull, Legs, Core, Full Body, Cardio, Mobility). The seed set uses a
--    new locked 7-value set instead (Push, Pull, Legs, Core,
--    Cardio/Mobility, Plyometric/Sprint, Other/Custom) — folds Cardio
--    and Mobility into one bucket, drops the vague "Full Body", adds a
--    real Plyometric/Sprint bucket for the new jump/sprint content.
--    Existing rows get remapped forward (Cardio/Mobility -> merged;
--    Full Body -> Other/Custom, the closest honest fit) rather than left
--    on values the new constraint would reject.
-- 2. Plane of motion (Sagittal/Frontal/Transverse/Multi-planar) has
--    nowhere to land — new column on movement_pattern_exercises, where
--    tier already lives, since plane is a property of an exercise's
--    place in its pattern, not of the pattern itself.

alter table public.exercise_library drop constraint exercise_library_category_check;

update public.exercise_library set category = 'Cardio/Mobility' where category in ('Cardio', 'Mobility');
update public.exercise_library set category = 'Other/Custom' where category = 'Full Body';

alter table public.exercise_library add constraint exercise_library_category_check
  check (category is null or category = any (array[
    'Push', 'Pull', 'Legs', 'Core', 'Cardio/Mobility', 'Plyometric/Sprint', 'Other/Custom'
  ]));

alter table public.movement_pattern_exercises add column plane text
  check (plane is null or plane = any (array['Sagittal', 'Frontal', 'Transverse', 'Multi-planar']));
