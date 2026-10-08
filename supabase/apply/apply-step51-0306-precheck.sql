-- STEP 51 (PRECHECK, run first, changes nothing): 0306 Target-change notice: when a coach applies a new daily calorie target the client is told, with fixed wording and a link to their Nutrition page, so they can answer 'are you happy with your meal plan?' (adds one notification type to the list the database already has)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('client_macro_target_history and notifications exist',
      to_regclass('public.client_macro_target_history') is not null and to_regclass('public.notifications') is not null),
    ('0306 is not already applied (the notice function is not there yet)',
      not exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
