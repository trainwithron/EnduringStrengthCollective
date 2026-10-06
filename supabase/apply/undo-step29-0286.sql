-- UNDO for step 29 (0286). Only if favorites misbehave after step 29. Removes the favorite foods (the starred foods are deleted; logged entries are not touched) and the added columns. The old recipe hearts stay.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists recipe_favorites_limit_food on public.recipe_favorites;
drop function if exists public.limit_food_favorites();
delete from public.recipe_favorites where kind = 'food';
drop index if exists public.recipe_favorites_food_idx;
alter table public.recipe_favorites drop constraint if exists recipe_favorites_food_snapshot;
alter table public.recipe_favorites drop constraint if exists recipe_favorites_kind_check;
alter table public.recipe_favorites drop column if exists fat_g;
alter table public.recipe_favorites drop column if exists carbs_g;
alter table public.recipe_favorites drop column if exists protein_g;
alter table public.recipe_favorites drop column if exists calories;
alter table public.recipe_favorites drop column if exists label;
alter table public.recipe_favorites drop column if exists kind;
commit;
