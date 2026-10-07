-- STEP 41 (PRECHECK, run first, changes nothing): 0296 recipe library columns: where a recipe came from (the coach or an approved AI option), tags computed when it is saved (allergens, intolerances, diets), its main protein, its reference macros, a fingerprint so the same option saved twice is one recipe, and the line amounts the meal builder scales; a line of an AI recipe must be matched to a real food
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('recipes and recipe_ingredients exist',
      to_regclass('public.recipes') is not null and to_regclass('public.recipe_ingredients') is not null),
    ('0296 is not already applied (recipes has no content_hash yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipes' and column_name = 'content_hash')),
    ('0296 is not already applied (recipe_ingredients has no grams_ref yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipe_ingredients' and column_name = 'grams_ref'))
) as checks(check_name, ok);
