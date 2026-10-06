-- STEP 12 (PRECHECK, run first, changes nothing): 0270 a coach can only add their own clients to a group (closes the hole that lets any coach add any user)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0238 is applied (the loose self-join is gone)',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self') and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check like '%has_valid_group_invite%')),
    ('is_coach_of_athlete and is_org_admin_of_group exist',
      exists (select 1 from pg_proc where proname = 'is_coach_of_athlete' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_org_admin_of_group' and pronamespace = 'public'::regnamespace)),
    ('0270 is not already applied',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check not like '%is_coach_of_athlete%'))
) as checks(check_name, ok);
