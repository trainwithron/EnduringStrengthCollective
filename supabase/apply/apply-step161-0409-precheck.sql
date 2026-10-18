-- STEP 161 (PRECHECK, run first, changes nothing): 0409 Release M1: failed payments, refunds and disputes are recorded and the coach is told (a ledger of money events, one new kind of notice, a platform report); no money moves
--
-- !! This REBUILDS the list of allowed notice kinds (adds one: payment_problem). It refuses to run if the live list cannot be read or would lose a kind, and changes nothing in that case.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0409 is not already applied (the money events table is not there yet)',
      to_regclass('public.payment_events') is null),
    ('the tables and helpers it uses exist',
      to_regclass('public.groups') is not null and to_regclass('public.profiles') is not null and to_regclass('public.membership_subscriptions') is not null and to_regclass('public.group_memberships') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null),
    ('the notification type rule exists to be widened',
      exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
) as checks(check_name, ok);
