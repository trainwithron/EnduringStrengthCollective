-- STEP 99 (PRECHECK, run first, changes nothing): 0353 A coach can ask for notice before a client pauses, freezes or ends a weekly schedule, and can add their own wording
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0353 is not already applied (no notice column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'schedule_change_notice_days')),
    ('the schedule-request function exists',
      to_regprocedure('public.request_schedule_change(uuid, text, date, date, text)') is not null)
) as checks(check_name, ok);
