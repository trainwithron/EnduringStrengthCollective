-- STEP 124 (PRECHECK, run first, changes nothing): 0374 A coach can ask a client to count a record from imported history as a real one
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0374 is not already applied (no promotions table yet)',
      to_regclass('public.pr_promotions') is null),
    ('the notifications table and the inactive-client rule exist',
      to_regclass('public.notifications') is not null and to_regprocedure('public.resurface_inactive_client()') is not null),
    ('the org wall check exists',
      to_regprocedure('public.group_in_active_org(uuid)') is not null)
) as checks(check_name, ok);
