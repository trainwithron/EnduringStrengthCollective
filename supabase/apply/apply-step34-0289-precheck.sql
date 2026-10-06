-- STEP 34 (PRECHECK, run first, changes nothing): 0289 a window of hours can be tagged with one of your session types (Online, In person, Weight room, Practice, Game...), and a booking made inside it is tagged the same
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('coach_availability_windows and session_types exist',
      to_regclass('public.coach_availability_windows') is not null and to_regclass('public.session_types') is not null),
    ('bookings has the session type column (0261 is applied)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'session_type_id')),
    ('0289 is not already applied (the window tag column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_type_id'))
) as checks(check_name, ok);
