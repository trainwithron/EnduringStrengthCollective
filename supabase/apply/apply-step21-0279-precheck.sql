-- STEP 21 (PRECHECK, run first, changes nothing): 0279 with self-booking off a client asks to move a session and the coach confirms (the session stays put until then)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0277 is applied (late-change flags exist)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'late_charge_state')),
    ('0278 is applied (the self-booking switch exists)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'self_booking_enabled')),
    ('coach_availability_windows and discovery_bookings exist',
      to_regclass('public.coach_availability_windows') is not null and to_regclass('public.discovery_bookings') is not null),
    ('0279 is not already applied (the live reschedule_booking is exactly the step 19 version, and there is no request table yet)',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '1df6fdc5b7ed651158e1d39b99312519' from pg_proc p where p.oid = to_regprocedure('public.reschedule_booking(uuid, timestamptz, timestamptz)')), false) and to_regclass('public.booking_move_requests') is null)
) as checks(check_name, ok);
