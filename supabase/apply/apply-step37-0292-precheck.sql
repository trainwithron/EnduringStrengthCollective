-- STEP 37 (PRECHECK, run first, changes nothing): 0292 the AI call log records why a call failed (a short error class), so an AI outage can be diagnosed
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('ai_usage_log exists',
      to_regclass('public.ai_usage_log') is not null),
    ('0292 is not already applied (the error_class column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_log' and column_name = 'error_class'))
) as checks(check_name, ok);
