-- STEP 48 (PRECHECK, run first, changes nothing): 0303 What a client pays becomes coach-only: the coach's manual monthly rate moves off the roster table (which every member of a group could read) into its own table that only the group's coaches can read or write; the existing values are copied across and the old column is dropped
--
-- !! Run this right before the code of the same release is deployed: the code that is live today still reads the old column, so the Business estimate shows empty between this paste and the deploy (nothing else is affected).
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('group_memberships, groups and is_group_coach exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.groups') is not null and exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace)),
    ('0303 is not already applied (client_billing_rates is not there yet)',
      to_regclass('public.client_billing_rates') is null),
    ('the old rate column is still on group_memberships',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'))
) as checks(check_name, ok);
