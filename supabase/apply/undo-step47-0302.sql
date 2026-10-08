-- UNDO for step 47 (0302). Only if step 47 misbehaves. Removes the custom foods and saved meals people created since (what they logged from them stays in their food log).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.saved_meal_items;
drop table if exists public.saved_meals;
drop table if exists public.custom_foods;
drop function if exists public.guard_food_library_limits();
drop function if exists public.food_library_touch_updated_at();
drop function if exists public.nutrients_are_numbers(jsonb, numeric);
commit;
