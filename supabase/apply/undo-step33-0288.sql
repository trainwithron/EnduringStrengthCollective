-- UNDO for step 33 (0288). Only if bookings misbehave after step 33. Removes the extra overlap check and its lock; the booking functions' own overlap checks stay.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists bookings_guard_overlap on public.bookings;
drop trigger if exists discovery_bookings_guard_overlap on public.discovery_bookings;
drop function if exists public.guard_booking_overlap();
commit;
