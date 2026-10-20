-- STEP 180 (PRECHECK, run first, changes nothing): 0428 FIX 3: logging settles the session on the calendar once; no-show Charge or Waive; a late move is one session; the walk-in (two new functions, four helpers, six replaced)
--
-- !! This REPLACES six functions: complete_workout_session (ONE block, the credit block at the end, read back from the live text between two exact lines, as 0231 did; everything else in it is untouched), settle_booking_internal (one check added: never on a no-show), set_booking_no_show, resolve_late_change, cancel_booking_and_refund_credit (one block added) and undo_booking_attended. It adds resolve_no_show, create_walk_in_booking and four internal helpers (match_booking_for_session, booking_taken, booking_late_move_charged, booking_put_back). The paste checks that every one of the six is exactly the text this was written against, and stops if not. Rehearsed: no visit ever takes two sessions, in any order of marks and undos.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0428 is not already applied (resolve_no_show is not there yet)',
      not (to_regprocedure('public.resolve_no_show(uuid, boolean)') is not null)),
    ('complete_workout_session is exactly the text this patches',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '449f62e5c0bf40cc3e977d245da6bb52' from pg_proc p where p.oid = to_regprocedure('public.complete_workout_session(uuid)')), false)),
    ('set_booking_no_show is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'a7c72a975e43c47ffb6c70db180dcc5d' from pg_proc p where p.oid = to_regprocedure('public.set_booking_no_show(uuid, boolean)')), false)),
    ('resolve_late_change is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'f458e9d57b0e269898644bcbf5e7ddd8' from pg_proc p where p.oid = to_regprocedure('public.resolve_late_change(uuid, boolean)')), false)),
    ('cancel_booking_and_refund_credit is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'a7d04dd98d255ada0986146551f86c82' from pg_proc p where p.oid = to_regprocedure('public.cancel_booking_and_refund_credit(uuid)')), false)),
    ('undo_booking_attended is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'aec909b45acd546b99ac619f6a7e251a' from pg_proc p where p.oid = to_regprocedure('public.undo_booking_attended(uuid)')), false)),
    ('settle_booking_internal is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '57e0bcda3433f457b0377ee8b165841b' from pg_proc p where p.oid = to_regprocedure('public.settle_booking_internal(uuid, integer, text, uuid, uuid, uuid)')), false)),
    ('the functions and tables it uses exist',
      to_regprocedure('public.apply_session_credit_change(uuid, uuid, integer, text, text, uuid, uuid)') is not null and to_regprocedure('public.coach_time_zone(uuid)') is not null and to_regprocedure('public.offer_freed_slot_to_waitlist(uuid, timestamptz, timestamptz)') is not null and to_regclass('public.coach_availability_windows') is not null and to_regclass('public.discovery_bookings') is not null)
) as checks(check_name, ok);
