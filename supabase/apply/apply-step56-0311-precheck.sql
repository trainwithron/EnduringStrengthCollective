-- STEP 56 (PRECHECK, run first, changes nothing): 0311 A client can ask for a different meal plan (up to 3 times per plan): a table of the tries with a copy of the plan from before each one, the server-only function that applies a try (counts the tries, refuses a 4th, never touches a day the coach built by hand, tells the coach in fixed wording), the coach's one-tap put-back function, and one notification type added to the list the database already has
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('meal_plans, notifications and group_memberships exist',
      to_regclass('public.meal_plans') is not null and to_regclass('public.notifications') is not null and to_regclass('public.group_memberships') is not null),
    ('is_group_coach exists',
      exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace)),
    ('0311 is not already applied (the tries table is not there yet)',
      to_regclass('public.meal_plan_tries') is null)
) as checks(check_name, ok);
