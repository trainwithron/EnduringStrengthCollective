-- STEP 49 (PRECHECK, run first, changes nothing): 0304 What a client pays (part two): drops the old, now empty, rate column from the roster table (anything the old code wrote there since step 48 is copied across first)
--
-- !! Run this ONLY AFTER the release's code is deployed and live: code that still selects the old column in the same query as the roster would stop showing the roster. Step 48 must already be applied.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('step 48 is applied (client_billing_rates exists)',
      to_regclass('public.client_billing_rates') is not null),
    ('0304 is not already applied (the old rate column is still on group_memberships)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'))
) as checks(check_name, ok);
