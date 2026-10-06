-- STEP 32 (PRECHECK, run first, changes nothing): 0287 a session can be longer than the time between slot starts (a start every 15 minutes with a 55-minute session); the session still has to fit inside its window
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('coach_availability_windows has the session length column (step 25 / 0283 is applied)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_minutes')),
    ('0287 is not already applied (the old rule, a session no longer than the step, is still the rule)',
      exists (select 1 from pg_constraint where conname = 'coach_availability_windows_session_minutes_range' and pg_get_constraintdef(oid) like '%slot_duration_minutes%')),
    ('no window already has hours where the end is not after the start',
      not exists (select 1 from public.coach_availability_windows where end_time <= start_time))
) as checks(check_name, ok);
