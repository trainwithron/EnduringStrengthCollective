-- STEP 48 (PRECHECK, run first, changes nothing): 0303 What a client pays becomes coach-only (part one): the coach's manual monthly rate moves off the roster table (which every member of a group could read) into its own table that only the group's coaches can read or write (the organization's owner and admins can read it); the existing rates are copied across and the old column is emptied, so the leak is closed at once
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('group_memberships, groups, is_group_coach and is_org_admin_of_group exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.groups') is not null and exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_org_admin_of_group' and pronamespace = 'public'::regnamespace)),
    ('0303 is not already applied (client_billing_rates is not there yet)',
      to_regclass('public.client_billing_rates') is null),
    ('the old rate column is still on group_memberships',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'))
) as checks(check_name, ok);
