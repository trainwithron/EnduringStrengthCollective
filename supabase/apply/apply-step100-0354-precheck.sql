-- STEP 100 (PRECHECK, run first, changes nothing): 0354 The money settings on an organization membership are the server's: the connected Stripe account can no longer be written by an owner or anyone signed in, and the shares in an organization can never add up to more than 100 percent
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0354 is not already applied (the share-total rule does not exist yet)',
      to_regprocedure('public.guard_organization_share_total()') is null),
    ('the memberships table has the money columns',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'stripe_connect_account_id') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'revenue_share_pct'))
) as checks(check_name, ok);
