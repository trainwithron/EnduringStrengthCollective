-- STEP 09 (PRECHECK, run first, changes nothing): 0238 close the old self-join (LAST, after the invite-join test passed)
--
-- !! Do NOT run this until supabase/ron-test-invite-join.md passed, and the live site's deployed code is at least commit 0019772 (the invite page must call join_group_with_invite). If the deployed app is older, every invite link would stop working.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0237 and 0242 are applied (join_group_with_invite exists, group_invites.revoked_at exists)',
      exists (select 1 from pg_proc where proname = 'join_group_with_invite' and pronamespace = 'public'::regnamespace) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_invites' and column_name = 'revoked_at')),
    ('the loose self-join policy is still there (0238 is not already applied)',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self'))
) as checks(check_name, ok);
