-- STEP 162 (PRECHECK, run first, changes nothing): 0410 Release SP1: a reply in a support thread tells the other side (a bell notice and a push)
--
-- !! This REBUILDS the list of allowed notice kinds (adds one: support_reply). It refuses to run if the live list cannot be read or would lose a kind, and changes nothing in that case.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0410 is not already applied (the support notice trigger is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'support_messages_notify' and not tgisinternal)),
    ('the support tables exist',
      to_regclass('public.support_requests') is not null and to_regclass('public.support_messages') is not null and to_regclass('public.notifications') is not null),
    ('the notification type rule exists to be widened',
      exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
) as checks(check_name, ok);
