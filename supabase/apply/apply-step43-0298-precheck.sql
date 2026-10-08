-- STEP 43 (PRECHECK, run first, changes nothing): 0298 Read during rest: the client's own on/off switch (a table only that client can read or write), the coach's switch for all their clients, the coach's choice of passage for a day, and one function the client's screen asks (is Read on for me here, is there a coach's passage today, have I seen the note); the passages themselves are in the app
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('profiles, group_memberships and coach_preferences exist',
      to_regclass('public.profiles') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.coach_preferences') is not null),
    ('0298 is not already applied (read_settings is not there yet)',
      to_regclass('public.read_settings') is null),
    ('0298 is not already applied (coach_preferences has no faith_track_default yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_preferences' and column_name = 'faith_track_default'))
) as checks(check_name, ok);
