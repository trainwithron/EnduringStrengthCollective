-- STEP 21 (PRECHECK, run first, changes nothing): 0279 booking requests: in 'request' mode a client asks for a new session or to move one, and the coach confirms (nothing is booked or held until then)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0277 is applied (late-change flags exist)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'late_charge_state')),
    ('0278 is applied (the booking mode exists)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'booking_mode') and exists (select 1 from pg_proc where proname = 'coach_booking_mode' and pronamespace = 'public'::regnamespace)),
    ('coach_availability_windows, coach_availability_exceptions and discovery_bookings exist',
      to_regclass('public.coach_availability_windows') is not null and to_regclass('public.coach_availability_exceptions') is not null and to_regclass('public.discovery_bookings') is not null),
    ('is_org_admin_of_group and offer_freed_slot_to_waitlist exist',
      exists (select 1 from pg_proc where proname = 'is_org_admin_of_group' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'offer_freed_slot_to_waitlist' and pronamespace = 'public'::regnamespace)),
    ('0279 is not already applied (the live reschedule_booking is exactly the step 19 version, and there is no request table yet)',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '1283df1e48a57927374db97199ad00eb' from pg_proc p where p.oid = to_regprocedure('public.reschedule_booking(uuid, timestamptz, timestamptz)')), false) and to_regclass('public.booking_requests') is null)
) as checks(check_name, ok);
