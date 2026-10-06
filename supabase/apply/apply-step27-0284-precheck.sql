-- STEP 27 (PRECHECK, run first, changes nothing): 0284 a coach can propose a goal to a client, and the client confirms it, changes it or declines it (a coach cannot confirm it for them)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('client_goals and the notification type list exist',
      to_regclass('public.client_goals') is not null and exists (select 1 from pg_constraint where conname = 'notifications_type_check')),
    ('is_group_coach exists',
      exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace)),
    ('0284 is not already applied (the coach proposal rule is not there yet)',
      not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_goals' and policyname = 'client_goals_insert_coach'))
) as checks(check_name, ok);
