-- YOUR OPEN HOURS: 55-MINUTE SESSIONS STARTING ON THE HOUR. Step 194, one paste, all or nothing.
--
-- Your hours were saved as "a start every 55 minutes", so the day drifted (6:00, 6:55, 7:50 ...). This saves them as a start every 60 minutes with 55-minute sessions,
-- which leaves your 5-minute gap: 6:00, 7:00, 8:00 ... Only your own 5 windows (Mon, Tue, Thu, Fri, Sat, 6 AM to 5 PM) change. Booked sessions are not touched.
-- WHAT YOU SHOULD SEE: "Success", then one row: windows_fixed = 5.
-- UNDO: run   update public.coach_availability_windows set slot_duration_minutes = 55, session_minutes = null where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8';

begin;

update public.coach_availability_windows
set slot_duration_minutes = 60, session_minutes = 55
where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8'
  and slot_duration_minutes = 55
  and session_minutes is null;

commit;

select count(*) as windows_fixed
from public.coach_availability_windows
where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and slot_duration_minutes = 60 and session_minutes = 55;
