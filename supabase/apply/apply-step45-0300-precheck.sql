-- STEP 45 (PRECHECK, run first, changes nothing): 0300 Food search and logging: USDA household portions (public reference table), a record of which USDA batches were loaded, and the optional detail of a searched food on a food log entry (source, USDA food, grams, serving, nutrient snapshot), with sanity limits on what can be logged from now on
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('food_log_entries and usda_foods exist',
      to_regclass('public.food_log_entries') is not null and to_regclass('public.usda_foods') is not null),
    ('0300 is not already applied (usda_food_portions is not there yet)',
      to_regclass('public.usda_food_portions') is null),
    ('0300 is not already applied (food_log_entries has no fdc_id yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'food_log_entries' and column_name = 'fdc_id'))
) as checks(check_name, ok);
