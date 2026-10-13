-- UNDO for step 108 (0360). Only if step 108 misbehaves. Puts the membership rule back as it was (adding a client would fail again) and removes the helper.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert
  to authenticated with check (
    (public.is_group_coach(group_id) and (profile_id = (select auth.uid()) or public.is_coach_of_athlete(profile_id)))
    or (
      profile_id = (select auth.uid())
      and role = 'coach'
      and public.is_org_admin_of_group(group_id)
      and not public.group_closed_to_org_admin_join(group_id)
    )
  );
drop function if exists public.group_is_new_and_mine(uuid);
commit;
