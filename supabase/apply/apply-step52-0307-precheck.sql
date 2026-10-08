-- STEP 52 (PRECHECK, run first, changes nothing): 0307 Release O fix: the target-change notice function is closed to the public and signed-in users like the other internal functions (it was left open by default; it is a trigger function so nobody could call it, but internal functions are server-only on purpose)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('step 51 is applied (the notice function exists)',
      exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace)),
    ('0307 is not already applied (signed-in users can still run the notice function)',
      coalesce((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.proname = 'notify_on_target_change' and p.pronamespace = 'public'::regnamespace), false))
) as checks(check_name, ok);
