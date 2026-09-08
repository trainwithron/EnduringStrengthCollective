-- Found live during QA (2026-09-08): handleAddSet in
-- exercise-builder-card.tsx computes the next set_order from the
-- `exercise.sets` closure, which is stale until React re-renders with the
-- new array. Two clicks on "+" close enough together (a fast real
-- double-click, not just automated testing) both read the same stale
-- length and insert two rows with the same set_order — a silent duplicate
-- invisible in the UI, since only one insert's result ends up in local
-- state. Confirmed this had already happened for real in production data
-- (the coach's own "Strong boi" program) before this constraint existed.
--
-- The app-side fix (disabling +/- while a request is in flight) closes the
-- realistic single-tab race; this constraint is the actual guarantee —
-- matches the same belt-and-suspenders pattern already used for
-- bookings_no_double_book.
alter table public.group_workout_exercise_sets
  add constraint group_workout_exercise_sets_unique_order
  unique (group_workout_exercise_id, set_order);
