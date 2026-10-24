-- STEP 184 (PRECHECK, run first, changes nothing): 0432 Session caps, Keep my sessions together and a lunch break (five columns on the booking policy, four functions, one call added to three booking functions)
--
-- !! This adds max_sessions_per_week, max_sessions_per_month (blank = no limit), keep_together (off) and lunch_start / lunch_end to coach_booking_policies, and five functions: coach_session_count (server only), my_session_count (signed-in: the coach's own count for their screens), client_slot_reason (server only: why a client may not have a time), assert_client_slot_offered (server only: the reason in words) and client_slot_reasons (signed-in, for a person who trains with that coach: what the screens offer). It then adds ONE call to each of book_session, reschedule_booking and check_booking_request_slot, right where they check the coach's hours; the paste checks that each holds that hours check exactly once, and stops if not. A coach booking for a client is never refused.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0432 is not already applied (client_slot_reason is not there yet)',
      to_regprocedure('public.client_slot_reason(uuid, timestamptz, timestamptz, uuid, boolean)') is null),
    ('book_session holds its hours check exactly once',
      coalesce((select (length(d) - length(replace(d, 'public.coach_time_is_open(p_coach_id, p_start_at, p_end_at)', ''))) / length('public.coach_time_is_open(p_coach_id, p_start_at, p_end_at)') = 1 from (select pg_get_functiondef(to_regprocedure('public.book_session(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)')) as d) x), false)),
    ('reschedule_booking holds its hours check exactly once',
      coalesce((select (length(d) - length(replace(d, 'public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at)', ''))) / length('public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at)') = 1 from (select pg_get_functiondef(to_regprocedure('public.reschedule_booking(uuid,timestamp with time zone,timestamp with time zone)')) as d) x), false)),
    ('check_booking_request_slot holds its hours check exactly once',
      coalesce((select (length(d) - length(replace(d, 'public.coach_time_is_open(p_coach_id, p_start, p_end)', ''))) / length('public.coach_time_is_open(p_coach_id, p_start, p_end)') = 1 from (select pg_get_functiondef(to_regprocedure('public.check_booking_request_slot(uuid,uuid,timestamp with time zone,timestamp with time zone)')) as d) x), false)),
    ('the tables and functions it uses exist',
      to_regclass('public.coach_booking_policies') is not null and to_regclass('public.coach_availability_windows') is not null and to_regclass('public.group_sessions') is not null and to_regprocedure('public.coach_time_is_open(uuid, timestamptz, timestamptz)') is not null and to_regprocedure('public.coach_time_zone(uuid)') is not null)
) as checks(check_name, ok);
