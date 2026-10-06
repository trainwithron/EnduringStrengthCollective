-- STEP 19 (PRECHECK, run first, changes nothing): 0277 a client's late cancel or late move is flagged for the coach to Charge or Waive (nothing is taken automatically)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0248 is applied (the credit functions exist)',
      exists (select 1 from pg_proc where proname = 'apply_session_credit_change' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'settle_booking_internal' and pronamespace = 'public'::regnamespace) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'credit_state')),
    ('bookings, notifications and coach_booking_policies exist',
      to_regclass('public.bookings') is not null and to_regclass('public.notifications') is not null and to_regclass('public.coach_booking_policies') is not null),
    ('0276 is applied (the notification type list includes direct_message)',
      exists (select 1 from pg_constraint where conname = 'notifications_type_check' and pg_get_constraintdef(oid) like '%direct_message%')),
    ('0277 is not already applied (the live cancel and reschedule functions are exactly the versions this step was built from)',
      coalesce((select md5(pg_get_functiondef(p.oid)) = 'b0485b9332f337b725669193b19f0887' from pg_proc p where p.oid = to_regprocedure('public.cancel_booking_and_refund_credit(uuid)')), false) and coalesce((select md5(pg_get_functiondef(p.oid)) = 'f45d1a198654ec4150e6ec958de3b1d1' from pg_proc p where p.oid = to_regprocedure('public.reschedule_booking(uuid, timestamptz, timestamptz)')), false))
) as checks(check_name, ok);
