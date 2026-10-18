-- STEP 155 (PRECHECK, run first, changes nothing): 0403 Release W3: every client goes through the health form and waiver, whichever door they came in by (a trigger flags someone who joins as a client without a finished form)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0403 is not already applied (the trigger is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'group_memberships_require_intake' and not tgisinternal)),
    ('the tables it reads exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.client_intake') is not null and to_regclass('public.profiles') is not null)
) as checks(check_name, ok);
