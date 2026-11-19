-- Starred meals for the coach's Nutrition page (Ron, Nov 19: "the coach facing nutrition page needs a revamp ... the fav meals tab is not very usefull at all"). A coach stars any
-- meal they see (a meal plan option, a meal from before a client's plan change, a meal a client logged) and the Favorite meals tab lists them, each with its calories and protein
-- and "Add to plan". It extends the existing favorites table (recipe_favorites, 0048; favorite foods are kind 'food', 0286) instead of adding a third one:
--  * A starred meal is a row with kind 'meal', its name (label), its macros AS THEY WERE WHEN IT WAS STARRED, and the meal itself (meal: the option as a plan stores it, so
--    "Add to plan" puts back exactly what was starred). Macros may be blank (a meal carried over from a recipe with no amounts).
--  * Private to the coach who starred it, as before: the existing policy only lets a person read and write their own rows.
--  * At most 200 starred meals per person (favorite foods keep their 60).
--  * The coach's own recipes (the ingredient-by-ingredient builder that leaves the tab) are each carried over as a starred meal for the coach who made them: their name and
--    ingredient names, nothing deleted. The recipes themselves are left exactly as they are.
-- Re-runnable. Needs recipe_favorites (0048, 0286) and recipes (Recipe Hub).

alter table public.recipe_favorites add column if not exists meal jsonb;

alter table public.recipe_favorites drop constraint if exists recipe_favorites_kind_check;
alter table public.recipe_favorites add constraint recipe_favorites_kind_check check (kind in ('recipe', 'food', 'meal'));

alter table public.recipe_favorites drop constraint if exists recipe_favorites_meal_snapshot;
alter table public.recipe_favorites add constraint recipe_favorites_meal_snapshot
  check (kind <> 'meal' or (label is not null and btrim(label) <> '' and length(label) <= 200 and meal is not null and jsonb_typeof(meal) = 'object'
    and pg_column_size(meal) <= 32768 and coalesce(calories, 0) >= 0 and coalesce(protein_g, 0) >= 0 and coalesce(carbs_g, 0) >= 0 and coalesce(fat_g, 0) >= 0));

create or replace function public.limit_food_favorites()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.kind = 'food' and (select count(*) from public.recipe_favorites f where f.profile_id = new.profile_id and f.kind = 'food') >= 60 then
    raise exception 'You can keep up to 60 favorite foods. Remove one to add another.';
  end if;
  if new.kind = 'meal' and (select count(*) from public.recipe_favorites f where f.profile_id = new.profile_id and f.kind = 'meal') >= 200 then
    raise exception 'You can keep up to 200 starred meals. Remove one to add another.';
  end if;
  return new;
end;
$function$;

-- Each coach recipe, as a starred meal for the coach who made it (the key is the one the app uses: "meal:" and the name in lower case, spaces collapsed).
insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories, protein_g, carbs_g, fat_g, meal)
select
  r.created_by,
  'meal:' || regexp_replace(lower(btrim(r.name)), '[[:space:]]+', ' ', 'g'),
  'meal',
  left(btrim(r.name), 200),
  nullif(r.reference_macros ->> 'kcal', '')::numeric,
  nullif(r.reference_macros ->> 'protein', '')::numeric,
  nullif(r.reference_macros ->> 'carbs', '')::numeric,
  nullif(r.reference_macros ->> 'fat', '')::numeric,
  jsonb_build_object(
    'recipeId', r.id::text,
    'recipeName', btrim(r.name),
    'ingredients', coalesce((select jsonb_agg(i.label order by i.sort_order) from public.recipe_ingredients i where i.recipe_id = r.id and i.label is not null), '[]'::jsonb),
    'source', 'coach',
    'key', 'r:' || r.id::text
  )
from public.recipes r
where btrim(r.name) <> ''
on conflict (profile_id, recipe_id) do nothing;
