-- STEP 96 (PRECHECK, run first, changes nothing): 0350 A coach's Pro Shop links, referral partners, challenges, calendar entries, session types and discovery-call prospects belong to an organization, and a client sees only the organization they are a client in
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0350 is not already applied (the shop links have no organization column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pro_shop_links' and column_name = 'organization_id')),
    ('the six tables exist',
      to_regclass('public.pro_shop_links') is not null and to_regclass('public.referral_partners') is not null and to_regclass('public.challenges') is not null and to_regclass('public.calendar_events') is not null and to_regclass('public.session_types') is not null and to_regclass('public.discovery_bookings') is not null),
    ('the helper is_client_of_coach exists',
      exists (select 1 from pg_proc where proname = 'is_client_of_coach' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
