-- STEP 120 (PRECHECK, run first, changes nothing): 0370 The Needs attention list can be quieted: Not now (a week) and No macros for a client
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0370 is not already applied (no snooze table yet)',
      to_regclass('public.attention_snoozes') is null),
    ('the memberships table exists',
      to_regclass('public.group_memberships') is not null)
) as checks(check_name, ok);
