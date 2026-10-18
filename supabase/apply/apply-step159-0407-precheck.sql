-- STEP 159 (PRECHECK, run first, changes nothing): 0407 Release Z1: take a client out of a group without destroying them (Remove from my clients, Delete permanently with 30 days to undo)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0407 is not already applied (the removals table is not there yet)',
      to_regclass('public.client_removals') is null),
    ('the tables and helpers it uses exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.profiles') is not null and to_regclass('public.client_billing_rates') is not null and to_regclass('public.membership_subscriptions') is not null and to_regclass('public.recurring_booking_series') is not null and to_regclass('public.booking_waitlist_entries') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.cancel_booking_and_refund_credit(uuid)') is not null and to_regprocedure('public.cancel_recurring_booking_series(uuid)') is not null and to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null)
) as checks(check_name, ok);
