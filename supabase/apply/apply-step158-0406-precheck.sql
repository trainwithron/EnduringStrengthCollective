-- STEP 158 (PRECHECK, run first, changes nothing): 0406 Release X2: an athlete no longer reads other athletes' membership rows (a restrictive read rule on group_memberships)
--
-- !! This CHANGES what athletes can read. Apply it ONLY AFTER step 156 is applied AND the Release X1 code is live (the athlete screens that list the group's people must already be using the narrow functions). Applying it earlier makes the @mention lists and the position leaderboard show only the coaches.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0406 is not already applied (the restrictive read rule is not there yet)',
      not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'group_memberships_select_narrow')),
    ('step 156 is applied (the narrow read functions exist)',
      to_regprocedure('public.group_member_names(uuid)') is not null and to_regprocedure('public.group_position_roster(uuid)') is not null),
    ('the helpers the rule uses exist',
      to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null)
) as checks(check_name, ok);
