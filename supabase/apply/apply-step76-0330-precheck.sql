-- STEP 76 (PRECHECK, run first, changes nothing): 0330 Only a real coach can have a public booking page or a public website (the row-security rule for changing them now also requires coaching a group)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0330 is not already applied (the booking page rule does not mention coaching yet)',
      not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage' and with_check like '%group_memberships%')),
    ('both public page tables exist (0261, 0321)',
      to_regclass('public.coach_booking_pages') is not null and to_regclass('public.coach_sites') is not null),
    ('both rules are the expected ones (your own row only)',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_sites' and policyname = 'coach_sites_own'))
) as checks(check_name, ok);
