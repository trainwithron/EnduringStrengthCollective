-- STEP 18 (PRECHECK, run first, changes nothing): 0276 a new direct message gives the recipient an in-app notice (one line per sender while unread, no message text)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('direct_messages and notifications exist',
      to_regclass('public.direct_messages') is not null and to_regclass('public.notifications') is not null),
    ('0243 is applied (the notification type list includes email_changed)',
      exists (select 1 from pg_constraint where conname = 'notifications_type_check' and pg_get_constraintdef(oid) like '%email_changed%')),
    ('0276 is not already applied',
      not exists (select 1 from pg_trigger where tgname = 'direct_messages_notify'))
) as checks(check_name, ok);
