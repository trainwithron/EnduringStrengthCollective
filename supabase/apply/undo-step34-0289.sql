-- UNDO for step 34 (0289). Only if tagging misbehaves after step 34. Removes the window tag column (the tags on windows are lost) and the automatic tagging of new bookings. Types already on bookings stay.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists bookings_tag_session_type on public.bookings;
drop function if exists public.tag_booking_session_type();
drop trigger if exists coach_availability_windows_guard_type on public.coach_availability_windows;
drop function if exists public.guard_window_session_type();
drop index if exists public.coach_availability_windows_session_type_id_idx;
alter table public.coach_availability_windows drop column if exists session_type_id;
commit;
