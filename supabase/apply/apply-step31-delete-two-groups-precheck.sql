-- STEP 31 (PRECHECK, run first, changes nothing): delete Main Group and the stray Coast to Coast group (only after the copy is checked); everything in them is first saved in cleanup_backups
--
-- !! DELETES two groups. Run steps 26 and 30 first and check the copy. It refuses by itself if either group has a client, a logged workout, a booking, a session record, a purchase or a balance, or if the copy is missing or does not match.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('both groups exist',
      (select count(*) from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) = 2),
    ('the copy of christmas_abs_program is in The Home Team',
      exists (select 1 from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program')),
    ('neither group has a client',
      not exists (select 1 from public.group_memberships where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182') and role = 'athlete')),
    ('neither group has a logged workout, a booking or a session record',
      not exists (select 1 from public.workout_logs where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) and not exists (select 1 from public.bookings where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) and not exists (select 1 from public.athlete_sessions where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182'))),
    ('step 31 is not already applied (both groups are still there)',
      (select count(*) from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) = 2)
) as checks(check_name, ok);
