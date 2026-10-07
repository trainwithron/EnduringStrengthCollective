-- STEP 36 (PRECHECK, run first, changes nothing): 0291 booking and credit closures: a booking, a waiting-list place or a weekly schedule must name a coach who coaches that group, a client cannot cancel or move a session that has already started or been marked attended, and the nightly credit expiry becomes one locked step that takes only an amount
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('assert_client_may_book_directly exists (0278 is applied)',
      exists (select 1 from pg_proc where proname = 'assert_client_may_book_directly' and pronamespace = 'public'::regnamespace)),
    ('bookings, recurring_booking_series and booking_waitlist_entries exist',
      to_regclass('public.bookings') is not null and to_regclass('public.recurring_booking_series') is not null and to_regclass('public.booking_waitlist_entries') is not null),
    ('the credit functions and expiry record exist (0248 and the expiry table are applied)',
      exists (select 1 from pg_proc where proname = 'apply_session_credit_change' and pronamespace = 'public'::regnamespace) and to_regclass('public.session_credit_expirations') is not null),
    ('0291 is not already applied (book_session does not check the coach yet)',
      coalesce((select position('that coach does not coach this group' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace), false))
) as checks(check_name, ok);
