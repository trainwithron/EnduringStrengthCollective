-- STEP 20 (PRECHECK, run first, changes nothing): 0278 clients can book their own sessions (one at a time, weekly, or by joining a waiting list) only when the coach switches self-booking on (off by default)
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
    ('0278 is not already applied (the live book_session, weekly-schedule and waiting-list functions are exactly the versions this step was built from)',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'da934a4629a0f09580619b7c908ab42a' from pg_proc p where p.oid = to_regprocedure('public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)')), false) and coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'a14562f9889b8094e99a5403e5423835' from pg_proc p where p.oid = to_regprocedure('public.create_recurring_booking_series(uuid, uuid, uuid, timestamptz, integer, integer)')), false) and coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'f2d3243ac4fcf1876d894178e8a937f7' from pg_proc p where p.oid = to_regprocedure('public.join_booking_waitlist(uuid, uuid, uuid, timestamptz, timestamptz)')), false))
) as checks(check_name, ok);
