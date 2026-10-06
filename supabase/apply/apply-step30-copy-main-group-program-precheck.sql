-- STEP 30 (PRECHECK, run first, changes nothing): copy the program christmas_abs_program from Main Group into The Home Team (nothing is deleted; run check-copy-result.sql afterwards and look at it before step 31)
--
-- !! Run AFTER step 26 (The Home Team moved into Coast2Coast Fitness). The original program is not touched. Afterwards run check-copy-result.sql: it shows the original and the copy side by side.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the program christmas_abs_program exists in Main Group',
      exists (select 1 from public.programs where id = '5b8a8a3a-344d-4192-a892-f74494fff9ab' and group_id = 'b292055b-edc6-4171-ad2b-a89d65dcd8db')),
    ('The Home Team exists',
      exists (select 1 from public.groups where id = '060017b5-e613-4204-a101-c6a14c3a9630')),
    ('step 30 is not already applied (The Home Team has no copy yet)',
      not exists (select 1 from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program')),
    ('duplicate_program exists',
      to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is not null)
) as checks(check_name, ok);
