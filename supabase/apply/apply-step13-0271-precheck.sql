-- STEP 13 (PRECHECK, run first, changes nothing): 0271 database functions are runnable by signed-in users and the server only (not by the public internet), except the three the public pages call
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the helper functions row security uses exist',
      exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_group_member' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_org_member' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_platform_admin' and pronamespace = 'public'::regnamespace)),
    ('the three public pages'' functions exist',
      exists (select 1 from pg_proc where proname = 'get_invite_info' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'book_discovery_call' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'submit_gym_visitor_lead' and pronamespace = 'public'::regnamespace)),
    ('0271 is not already applied (the signed-out role can still run most functions today)',
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')) > 10)
) as checks(check_name, ok);
