-- UNDO for step 32 (0287). Only if overlapping starts misbehave. Restores the 0283 rule (a session no longer than the step). Any window with a session longer than its step is changed to a session the same as its step first; nothing else is touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
-- Puts the old rule back (a session no longer than the step). A window set up under the new rule (a session longer than its step) is first made the same as its step, so the old rule can be applied.
update public.coach_availability_windows set session_minutes = slot_duration_minutes where session_minutes is not null and session_minutes > slot_duration_minutes;
alter table public.coach_availability_windows drop constraint if exists coach_availability_windows_session_minutes_range;
alter table public.coach_availability_windows add constraint coach_availability_windows_session_minutes_range check (session_minutes is null or (session_minutes between 5 and 480 and session_minutes <= slot_duration_minutes));
commit;
