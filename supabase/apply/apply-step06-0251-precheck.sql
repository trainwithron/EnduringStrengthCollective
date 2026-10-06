-- STEP 06 (PRECHECK, run first, changes nothing): 0251 kiosk PINs stored hashed with a five-wrong-tries lockout
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('group_memberships.kiosk_pin exists (the plain column the PINs are copied from)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'kiosk_pin')),
    ('pgcrypto is available on this database',
      exists (select 1 from pg_available_extensions where name = 'pgcrypto')),
    ('the extensions schema exists',
      exists (select 1 from pg_namespace where nspname = 'extensions')),
    ('is_group_coach exists',
      exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace)),
    ('0251 is not already applied',
      to_regclass('public.kiosk_pins') is null)
) as checks(check_name, ok);
