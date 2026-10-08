-- STEP 54 (PRECHECK, run first, changes nothing): 0309 New training block notice: when a coach moves a client to a new phase the client sees one plain line in their bell, with no phase words (adds one notification type to the list the database already has)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('client_phase_plans and notifications exist',
      to_regclass('public.client_phase_plans') is not null and to_regclass('public.notifications') is not null),
    ('0309 is not already applied (the notice function is not there yet)',
      not exists (select 1 from pg_proc where proname = 'notify_on_new_training_block' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
