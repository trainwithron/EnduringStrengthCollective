-- Nutrition phase 4b: what the library-first meal builder needs from the recipes tables, and nothing else.
--
-- The starter library (Ron's 66 recipes) lives in CODE, so there is no seed and no change to who can read or write a recipe: the row security from 0056 stays exactly as it
-- is (the coach manages their own recipes, a client in the coach's group can read them). These columns are for the coach's OWN recipes, and for the AI-made options a
-- coach approves and saves into their private library:
--   recipes.source          'coach' (typed in by the coach) or 'ai' (an approved AI option saved to the library)
--   recipes.visibility      'private' only for now ('shared' is reserved: the check refuses it until sharing is built)
--   recipes.allergens / intolerance_tags / diet_tags
--                           tags computed by the app when the recipe is saved (a speed filter: the real lines are re-checked against the client's current rules before a meal is used)
--   recipes.main_protein    the food that supplies most of the protein ("chicken"), so a day's three options can use different ones
--   recipes.reference_macros the macros of the recipe at its reference amounts (protein, carbs, fat, kcal)
--   recipes.verified_at     when the lines were matched against real food data (AI options only)
--   recipes.content_hash    a fingerprint of the lines, unique per owner, so the same option saved twice is one recipe
--   recipe_ingredients.grams_ref  the line's reference grams (the recipe's own amounts), which the library scaler multiplies by one factor per role to hit a slot's target
-- A line of an AI recipe must be matched to a real food (usda_fdc_id), unless it is a fixed text line. Re-runnable. Nothing is dropped or rewritten.

alter table public.recipes
  add column if not exists source text not null default 'coach',
  add column if not exists visibility text not null default 'private',
  add column if not exists allergens text[] not null default '{}',
  add column if not exists intolerance_tags text[] not null default '{}',
  add column if not exists diet_tags text[] not null default '{}',
  add column if not exists main_protein text,
  add column if not exists reference_macros jsonb,
  add column if not exists verified_at timestamptz,
  add column if not exists content_hash text;

alter table public.recipes drop constraint if exists recipes_source_ok;
alter table public.recipes add constraint recipes_source_ok check (source in ('coach', 'ai'));
alter table public.recipes drop constraint if exists recipes_visibility_ok;
alter table public.recipes add constraint recipes_visibility_ok check (visibility = 'private');
alter table public.recipes drop constraint if exists recipes_tags_ok;
alter table public.recipes add constraint recipes_tags_ok check (
  coalesce(cardinality(allergens), 0) <= 20 and coalesce(cardinality(intolerance_tags), 0) <= 20 and coalesce(cardinality(diet_tags), 0) <= 20
);
alter table public.recipes drop constraint if exists recipes_main_protein_ok;
alter table public.recipes add constraint recipes_main_protein_ok check (main_protein is null or char_length(main_protein) <= 60);
alter table public.recipes drop constraint if exists recipes_reference_macros_ok;
alter table public.recipes add constraint recipes_reference_macros_ok check (reference_macros is null or jsonb_typeof(reference_macros) = 'object');
alter table public.recipes drop constraint if exists recipes_content_hash_ok;
alter table public.recipes add constraint recipes_content_hash_ok check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists recipes_owner_content_hash_uniq on public.recipes (created_by, content_hash) where content_hash is not null;

alter table public.recipe_ingredients add column if not exists grams_ref numeric;
alter table public.recipe_ingredients drop constraint if exists recipe_ingredients_grams_ref_ok;
alter table public.recipe_ingredients add constraint recipe_ingredients_grams_ref_ok check (grams_ref is null or (grams_ref > 0 and grams_ref <= 2000));

-- An AI recipe's measured lines must be matched to a real food. (A fixed text line has no macros and needs no match.)
create or replace function public.guard_ai_recipe_ingredient()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_source text;
begin
  if new.role = 'fixed' then
    return new;
  end if;
  select source into v_source from public.recipes where id = new.recipe_id;
  if v_source = 'ai' and new.usda_fdc_id is null then
    raise exception 'A line of an AI recipe must be matched to a real food.';
  end if;
  return new;
end;
$function$;

drop trigger if exists recipe_ingredients_guard_ai on public.recipe_ingredients;
create trigger recipe_ingredients_guard_ai
  before insert or update on public.recipe_ingredients
  for each row execute function public.guard_ai_recipe_ingredient();
