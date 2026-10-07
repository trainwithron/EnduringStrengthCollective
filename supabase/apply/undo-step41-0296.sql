-- UNDO for step 41 (0296). Only if the recipe library misbehaves after step 41. Removes the new recipe columns and their checks (the source, tags, main protein, reference macros and fingerprint of every saved recipe are lost, and the line amounts the builder scales), the unique fingerprint index, and the AI-line guard. The recipes and their lines themselves stay.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists recipe_ingredients_guard_ai on public.recipe_ingredients;
drop function if exists public.guard_ai_recipe_ingredient();
drop index if exists public.recipes_owner_content_hash_uniq;
alter table public.recipe_ingredients drop constraint if exists recipe_ingredients_grams_ref_ok;
alter table public.recipe_ingredients drop column if exists grams_ref;
alter table public.recipes drop constraint if exists recipes_source_ok, drop constraint if exists recipes_visibility_ok, drop constraint if exists recipes_tags_ok, drop constraint if exists recipes_main_protein_ok, drop constraint if exists recipes_reference_macros_ok, drop constraint if exists recipes_content_hash_ok;
alter table public.recipes drop column if exists source, drop column if exists visibility, drop column if exists allergens, drop column if exists intolerance_tags, drop column if exists diet_tags, drop column if exists main_protein, drop column if exists reference_macros, drop column if exists verified_at, drop column if exists content_hash;
commit;
