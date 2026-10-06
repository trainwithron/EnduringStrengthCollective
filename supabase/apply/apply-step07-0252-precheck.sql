-- STEP 07 (PRECHECK, run first, changes nothing): 0252 remove the plain-text kiosk PIN column (ONLY after the kiosk test passed)
--
-- !! Do NOT run this until supabase/ron-test-kiosk-checkin.md passed, and the live site's deployed code is at least commit 0019772 (it reads PINs through the hashed functions). After this the old column cannot be recovered except from a backup.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0251 is applied (kiosk_pins and verify_kiosk_pin exist)',
      to_regclass('public.kiosk_pins') is not null and exists (select 1 from pg_proc where proname = 'verify_kiosk_pin' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'set_kiosk_pin' and pronamespace = 'public'::regnamespace)),
    ('every athlete''s old plain PIN has a hashed copy (no PIN would be lost)',
      not exists (select 1 from public.group_memberships gm where gm.kiosk_pin is not null and gm.role = 'athlete' and not exists (select 1 from public.kiosk_pins kp where kp.group_id = gm.group_id and kp.athlete_id = gm.profile_id)))
) as checks(check_name, ok);
