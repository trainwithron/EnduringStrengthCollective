-- STEP 174 (PRECHECK, run first, changes nothing): 0422 Release TC3 part B: "Request to train with me" on a coach's public page (one new column, three new tables, eight functions, two notice kinds; a request grants nothing until the coach approves)
--
-- !! Adds one column (on by default) to the booking pages, three tables, eight functions and two notice kinds (the notification type list is rebuilt from the live list plus the two new kinds, and the paste stops if the result does not match). Nothing existing is replaced.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0422 is not already applied (the requests table is not there yet)',
      to_regclass('public.client_requests') is null),
    ('the tables and functions it uses exist',
      to_regclass('public.coach_booking_pages') is not null and to_regclass('public.client_intake') is not null and to_regclass('public.athlete_profile_details') is not null and to_regclass('public.notifications') is not null and to_regprocedure('public.age_threshold_date(date, integer)') is not null),
    ('the notification type list can be read',
      exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass))
) as checks(check_name, ok);
