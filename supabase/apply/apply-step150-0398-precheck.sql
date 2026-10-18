-- STEP 150 (PRECHECK, run first, changes nothing): 0398 Release S1: a changed sign-in email must be confirmed by the new address first (waiting requests table)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0398 is not already applied (the waiting-requests table is not there yet)',
      to_regclass('public.pending_email_changes') is null),
    ('the tables it builds on exist',
      to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null and to_regclass('public.notifications') is not null),
    ('the notification type rule exists to be widened',
      exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
) as checks(check_name, ok);
