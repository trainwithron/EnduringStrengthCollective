-- STEP 69 (PRECHECK, run first, changes nothing): 0323 Group events: a coach can add an event for one group (a monthly gym workout then lunch); members answer In or Out; it costs no session credit on any path, and the class functions now refuse an event
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0323 is not already applied (group_sessions has no kind column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_sessions' and column_name = 'kind')),
    ('the small-group session tables exist (0263)',
      to_regclass('public.group_sessions') is not null),
    ('booking_counts exists (0313, step 58)',
      exists (select 1 from pg_proc where proname = 'booking_counts' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
