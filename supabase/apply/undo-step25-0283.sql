-- UNDO for step 25 (0283). Only if something about booking times misbehaves after step 25. Removes the session length (every window goes back to sessions as long as the slot step; bookings already made keep their own times).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.coach_availability_windows drop constraint if exists coach_availability_windows_session_minutes_range;
alter table public.coach_availability_windows drop column if exists session_minutes;
commit;
