-- STEP 09: 0238 close the old self-join (LAST, after the invite-join test passed)
--
-- !! Do NOT run this until supabase/ron-test-invite-join.md passed, and the live site's deployed code is at least commit 0019772 (the invite page must call join_group_with_invite). If the deployed app is older, every invite link would stop working.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: People can only join a group through the invite function; coaches adding people and org admins adding themselves as coach are unchanged. Open one fresh invite link to confirm joining still works.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ====================================================================================================
-- migration 0238_close_loose_self_join_policy.sql
-- ====================================================================================================

-- APPLY ONLY AFTER the app version that calls join_group_with_invite (0237)
-- is deployed. Before that, the invite page still joins with a direct insert
-- and this would break every invite link.
--
-- Removes the self-join branch from the group_memberships insert policy.
-- Athletes now join exclusively through join_group_with_invite(), which is
-- bound to the real invite code. Coaches adding people, and org admins
-- adding themselves as coach, are unchanged.
drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert
  to authenticated
  with check (
    is_group_coach(group_id)
    or ((profile_id = (select auth.uid())) and role = 'coach' and is_org_admin_of_group(group_id))
  );

commit;
