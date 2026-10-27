-- STEP 190 (PRECHECK, run first, changes nothing): 0437 Share pictures carry the coach: an Instagram handle and a QR-code switch on the coach's public page settings
--
-- !! This adds two settings to coach_booking_pages: instagram_handle (none until a coach sets it; 1 to 30 letters, digits, "." and "_", stored without the @) and share_card_qr (on for every coach). Nothing else changes; row security is the table's existing rule.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0437 is not already applied (coach_booking_pages has no instagram_handle yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'instagram_handle')),
    ('coach_booking_pages has no share_card_qr yet',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'share_card_qr')),
    ('coach_booking_pages has its one row rule, coach_booking_pages_coach_manage (0330), and no other',
      (select count(*) from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages') = 1 and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage'))
) as checks(check_name, ok);
