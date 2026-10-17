-- STEP 147 (PRECHECK, run first, changes nothing): 0395 Release K1: push notifications that respect the person (quiet hours, private lock screen), a mark on each notice for the five-minute push job, and a payment notice type
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0395 is not already applied (the pushed-at mark is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'pushed_at')),
    ('the tables it builds on exist',
      to_regclass('public.profiles') is not null and to_regclass('public.notifications') is not null),
    ('the notification type rule exists to be widened',
      exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
) as checks(check_name, ok);
