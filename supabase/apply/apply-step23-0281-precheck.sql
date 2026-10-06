-- STEP 23 (PRECHECK, run first, changes nothing): 0281 inactive clients: a coach can set a client aside as inactive (reversible, nothing deleted, coach-only), and a workout, session or message from the client brings them back
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('group_memberships, workout_logs, bookings and direct_messages exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.workout_logs') is not null and to_regclass('public.bookings') is not null and to_regclass('public.direct_messages') is not null),
    ('is_org_admin_of_group exists',
      exists (select 1 from pg_proc where proname = 'is_org_admin_of_group' and pronamespace = 'public'::regnamespace)),
    ('0281 is not already applied (the set-aside table is not there yet)',
      to_regclass('public.client_inactive') is null)
) as checks(check_name, ok);
