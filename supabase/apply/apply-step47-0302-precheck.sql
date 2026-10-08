-- STEP 47 (PRECHECK, run first, changes nothing): 0302 Custom foods and saved meals: a client's own foods (with the numbers from a label, an optional full label and a barcode) and meals saved from several foods, private to the client and readable by their coaches, with limits on how many
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('profiles, usda_foods and is_coach_of_athlete exist',
      to_regclass('public.profiles') is not null and to_regclass('public.usda_foods') is not null and exists (select 1 from pg_proc where proname = 'is_coach_of_athlete' and pronamespace = 'public'::regnamespace)),
    ('0302 is not already applied (custom_foods is not there yet)',
      to_regclass('public.custom_foods') is null),
    ('0302 is not already applied (saved_meals is not there yet)',
      to_regclass('public.saved_meals') is null)
) as checks(check_name, ok);
