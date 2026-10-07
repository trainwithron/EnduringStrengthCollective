-- STEP 42 (PRECHECK, run first, changes nothing): 0297 pause, freeze or cancel a client's weekly schedule: a client asks (their own schedule only) and the change takes effect on the date they chose unless the coach handles it first; the request table, a coach-only table for the client's private note, the freeze dates on the schedule, the functions the app uses to apply a request and to restart a freeze on its day, a freeze that adds its length to the expiry of the client's unused sessions through the expiry hold that already exists, and three new notification types added to the list the database already has
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('recurring_booking_series, session_credits and session_credit_ledger exist',
      to_regclass('public.recurring_booking_series') is not null and to_regclass('public.session_credits') is not null and to_regclass('public.session_credit_ledger') is not null),
    ('the expiry hold and the coach''s expiry window exist (0280, 0209)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_credits' and column_name = 'expiry_hold_until') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'credit_expiry_days')),
    ('is_group_coach, is_org_admin_of_group, coach_time_zone and audit_watch exist (the new row security and functions use them)',
      exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_org_admin_of_group' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'coach_time_zone' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'audit_watch' and pronamespace = 'public'::regnamespace)),
    ('the notification types list exists and can be read (notifications_type_check)',
      exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)),
    ('0297 is not already applied (schedule_requests is not there yet)',
      to_regclass('public.schedule_requests') is null),
    ('0297 is not already applied (recurring_booking_series has no frozen_from yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring_booking_series' and column_name = 'frozen_from'))
) as checks(check_name, ok);
