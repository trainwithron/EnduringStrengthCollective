-- STEP 25 (PRECHECK, run first, changes nothing): 0283 session length separate from the slot step: a window can keep 60-minute slots with 55-minute sessions (a 5-minute gap), or any length up to the step
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('coach_availability_windows exists',
      to_regclass('public.coach_availability_windows') is not null),
    ('0283 is not already applied (the session length column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_minutes'))
) as checks(check_name, ok);
