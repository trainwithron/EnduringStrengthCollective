-- STEP 29 (PRECHECK, run first, changes nothing): 0286 favorite foods: a client can star a food they logged and log it again in one tap (extends recipe_favorites; private to the client; macros frozen as starred)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('recipe_favorites exists',
      to_regclass('public.recipe_favorites') is not null),
    ('0286 is not already applied (the favorite kind column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipe_favorites' and column_name = 'kind'))
) as checks(check_name, ok);
