-- STEP 93 (PRECHECK, run first, changes nothing): 0347 The daily briefing is made once per coach, per day, per organization (a coach who runs two organizations no longer gets one briefing built from both)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0347 is not already applied (the briefing has no organization column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_briefings' and column_name = 'organization_id')),
    ('the briefing table exists',
      to_regclass('public.coach_briefings') is not null)
) as checks(check_name, ok);
