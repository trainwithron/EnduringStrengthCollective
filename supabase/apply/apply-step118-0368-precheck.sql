-- STEP 118 (PRECHECK, run first, changes nothing): 0368 The one product shelf: where each package and Pro Shop card shows (public page, Client Home, Pro Shop) and who in the app sees it (everyone, not the one-on-one clients, only the one-on-one clients, one group); a program buyer can join the coach's client space
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0368 is not already applied (no placement columns yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'audience')),
    ('the Pro Shop table has the Featured flag',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pro_shop_links' and column_name = 'featured'))
) as checks(check_name, ok);
