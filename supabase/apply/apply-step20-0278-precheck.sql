-- STEP 20 (PRECHECK, run first, changes nothing): 0278 clients can book their own sessions only when the coach switches self-booking on (off by default)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0248 is applied (book_session settles credits)',
      exists (select 1 from pg_proc where proname = 'book_session' and pronamespace = 'public'::regnamespace) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'credit_state')),
    ('coach_booking_policies exists',
      to_regclass('public.coach_booking_policies') is not null),
    ('the live book_session is exactly the version this step was built from',
      coalesce((select md5(pg_get_functiondef(p.oid)) = 'da934a4629a0f09580619b7c908ab42a' from pg_proc p where p.oid = to_regprocedure('public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)')), false)),
    ('0278 is not already applied (the switch column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'self_booking_enabled'))
) as checks(check_name, ok);
