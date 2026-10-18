-- STEP 170 (PRECHECK, run first, changes nothing): 0418 Release AF3: database policies from the post-ship audit (a private client stays private in posts and tags; two undecided account-deletion links decided; the guardian-consent answer limited for a coach; the health-form flag cleared when the last client seat goes)
--
-- !! This REPLACES two posts policies, one tag policy, profile_reference_policy() and guardian_consent_state(), and adds two small functions and one trigger. It is not additions-only; every replaced text was compared with the live database before this was written and matches.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0418 is not already applied (the new trigger is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'group_memberships_clear_intake' and not tgisinternal)),
    ('the policies and functions it replaces exist',
      to_regprocedure('public.profile_reference_policy()') is not null and to_regprocedure('public.guardian_consent_state(uuid)') is not null and to_regprocedure('public.is_client_private_from_org(uuid, uuid)') is not null and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'posts_select_members') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_tag_assignments' and policyname = 'client_tag_assignments_select_org_member')),
    ('the columns it uses exist',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name in ('private_from_org')) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'membership_type') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at'))
) as checks(check_name, ok);
