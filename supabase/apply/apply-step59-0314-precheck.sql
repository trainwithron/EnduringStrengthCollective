-- STEP 59 (PRECHECK, run first, changes nothing): 0314 "Hide exercise demos" follows the person, not the device: one tiny private table (client_ui_settings, one row per client, only that client can read or change it)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('profiles exists',
      to_regclass('public.profiles') is not null),
    ('0314 is not already applied (client_ui_settings is not there yet)',
      to_regclass('public.client_ui_settings') is null)
) as checks(check_name, ok);
