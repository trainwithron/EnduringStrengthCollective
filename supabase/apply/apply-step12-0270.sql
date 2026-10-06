-- STEP 12: 0270 a coach can only add their own clients to a group (closes the hole that lets any coach add any user)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes for normal use: coaches still add their own clients to other groups, owners and admins still add themselves as coach, and invite links still work. A coach can no longer put a stranger into their group to read that person's private details.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check not like '%is_coach_of_athlete%'))) then
    raise exception 'Step 12 (0270) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0270_membership_insert_needs_a_real_client.sql
-- ====================================================================================================

-- A coach could add ANY signed-in person to their own group: the group_memberships insert policy only asked "is the caller a coach of
-- this group", not "is the person being added one of their clients". Once someone is in the group, the coach can read what coaches may
-- read about their members (date of birth, phone, emergency contact, training maxes, text-message consent, wearable data), so any coach
-- could pull a stranger's private details by adding them. (profiles are readable by every signed-in user, so the ids are easy to find.)
--
-- The coach branch now also needs the person being added to be the coach themselves or someone they already coach in another group
-- (is_coach_of_athlete, migration 0108). Moving or also-adding one of your own clients to another of your groups still works, and so does a
-- coach adding themselves. People who sign up through an invite link, and coaches added by an organization owner, go through server
-- routes with the service role (they skip row security) and are unaffected. The org-admin branch is unchanged.
drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert
  to authenticated
  with check (
    (
      public.is_group_coach(group_id)
      and (profile_id = (select auth.uid()) or public.is_coach_of_athlete(profile_id))
    )
    or ((profile_id = (select auth.uid())) and role = 'coach' and public.is_org_admin_of_group(group_id))
  );

commit;
