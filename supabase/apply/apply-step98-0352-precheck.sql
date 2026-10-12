-- STEP 98 (PRECHECK, run first, changes nothing): 0352 Joining an organization needs the person's OK: an owner can no longer put an existing account into their organization; an invitation is accepted or declined by the person, and any member can leave
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0352 is not already applied (the invitations table does not exist yet)',
      to_regclass('public.organization_invites') is null),
    ('the memberships table has the owner''s insert rule',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_memberships' and policyname = 'org_memberships_insert_owner'))
) as checks(check_name, ok);
