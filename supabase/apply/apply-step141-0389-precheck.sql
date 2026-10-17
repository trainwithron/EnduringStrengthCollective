-- STEP 141 (PRECHECK, run first, changes nothing): 0389 Release G: the app at 1,500 clients (last-active, unseen and digest counts done by the database, indexes), real values only in sets, a test-organization mark, and a way to pause forgotten workouts
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0389 is not already applied (the last-active function is not there yet)',
      to_regprocedure('public.business_last_active(uuid[])') is null),
    ('the tables it builds on exist',
      to_regclass('public.workout_logs') is not null and to_regclass('public.coach_view_state') is not null and to_regclass('public.set_logs') is not null and to_regclass('public.athlete_sessions') is not null and to_regclass('public.organizations') is not null and to_regclass('public.ai_usage_log') is not null),
    ('set_logs has the unclear flag (0371) the value rule leans on',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag'))
) as checks(check_name, ok);
