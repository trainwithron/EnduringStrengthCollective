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
