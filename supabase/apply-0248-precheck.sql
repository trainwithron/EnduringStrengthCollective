-- STEP 1 of 2 for migration 0248. Paste into the Supabase SQL editor and run on its own. It changes nothing.
-- Every row must say ok = true. If any row says false, do NOT run step 2 (apply-0248.sql); send the result back.
select check_name, ok
from (
  values
    ('0246 is applied (apply_session_credit_change exists)',
      to_regprocedure('public.apply_session_credit_change(uuid,uuid,integer,text,text,uuid,uuid)') is not null),
    ('0248 is not already applied (bookings has no credit_state column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'credit_state')),
    ('complete_workout_session still has the exact credit block 0248 rewrites',
      coalesce((select pg_get_functiondef(p.oid) like '%if v_session.logged_by_coach and v_session.deduct_session_credit and v_credit_cost > 0 then%set balance = greatest(0, balance - v_credit_cost), updated_at = v_completed_at%'
                from pg_proc p where p.proname = 'complete_workout_session' and p.pronamespace = 'public'::regnamespace), false)),
    ('recurring_booking_series table exists (0210)',
      to_regclass('public.recurring_booking_series') is not null),
    ('book_session, cancel_booking_and_refund_credit and reschedule_booking exist',
      to_regprocedure('public.book_session(uuid,uuid,uuid,timestamptz,timestamptz)') is not null
      and to_regprocedure('public.cancel_booking_and_refund_credit(uuid)') is not null
      and to_regprocedure('public.reschedule_booking(uuid,timestamptz,timestamptz)') is not null),
    ('offer_freed_slot_to_waitlist and is_training_client_of_group exist',
      to_regprocedure('public.offer_freed_slot_to_waitlist(uuid,timestamptz,timestamptz)') is not null
      and to_regprocedure('public.is_training_client_of_group(uuid,uuid)') is not null)
) as checks(check_name, ok);
