-- STEP 39 (PRECHECK, run first, changes nothing): 0294 food preferences and allergy safety: one preferences row per client (allergies, dislikes, diet type, protein target and floor) that the client edits for their tastes and a coach edits for the rules, a fixed-wording notice to the coaches when allergies or dislikes change, the client's answer to 'are you happy with your meal plan', and three new notification types added to the list the database already has
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('profiles, groups, group_memberships and notifications exist',
      to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.notifications') is not null),
    ('is_coach_of_athlete and is_group_coach exist (the new row security uses them)',
      to_regprocedure('public.is_coach_of_athlete(uuid)') is not null and exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace)),
    ('the notification types list exists and can be read (notifications_type_check)',
      exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)),
    ('0294 is not already applied (client_nutrition_preferences is not there yet)',
      to_regclass('public.client_nutrition_preferences') is null),
    ('0294 is not already applied (client_nutrition_feedback is not there yet)',
      to_regclass('public.client_nutrition_feedback') is null)
) as checks(check_name, ok);
