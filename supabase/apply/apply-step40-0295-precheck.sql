-- STEP 40 (PRECHECK, run first, changes nothing): 0295 about you, a starting target for a new client, and the phase a client is in: activity level and units on the client's own details (a coach writes the calculator inputs only through one function), a baseline kind of check-in suggestion with a fixed-wording notice to the coaches, the phase of record (coach-only, filled in from existing check-ins and milestone tags), and a coach-proposed goal that can carry a phase which becomes the phase of record only when the client confirms it, plus one new notification type added to the list the database already has
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('athlete_profile_details, nutrition_checkins, nutrition_checkin_suggestions, client_goals, nutrition_phases and notifications exist',
      to_regclass('public.athlete_profile_details') is not null and to_regclass('public.nutrition_checkins') is not null and to_regclass('public.nutrition_checkin_suggestions') is not null and to_regclass('public.client_goals') is not null and to_regclass('public.nutrition_phases') is not null and to_regclass('public.notifications') is not null),
    ('is_group_coach exists and guard_client_goal_update exists (0284 is applied)',
      exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace) and to_regprocedure('public.guard_client_goal_update()') is not null),
    ('the notification types list exists and can be read (notifications_type_check)',
      exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)),
    ('0295 is not already applied (client_phase_plans is not there yet)',
      to_regclass('public.client_phase_plans') is null),
    ('0295 is not already applied (athlete_profile_details has no activity_level yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_profile_details' and column_name = 'activity_level')),
    ('0295 is not already applied (client_goals has no nutrition_phase yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_goals' and column_name = 'nutrition_phase'))
) as checks(check_name, ok);
