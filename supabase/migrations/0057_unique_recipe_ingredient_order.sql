-- Same defense-in-depth as group_workout_exercise_sets_unique_order
-- (0055): the Recipe Hub's "Add ingredient" button had the identical
-- stale-closure race (computing sort_order from React state that's stale
-- until the insert's own response comes back) — fixed client-side with a
-- busy guard, backstopped here at the database level.
alter table public.recipe_ingredients
  add constraint recipe_ingredients_unique_order
  unique (recipe_id, sort_order);
