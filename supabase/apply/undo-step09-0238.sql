-- ONLY IF joining a group through an invite link breaks after step 09 (0238). Restores the previous rule exactly (read from the live database
-- before 0238): a signed-in person may add themselves as an athlete to a group that has a valid invite. Paste and run once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run step 09 again until Spot says why it failed.
begin;
drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert
  to authenticated
  with check (
    public.is_group_coach(group_id)
    or ((profile_id = (select auth.uid())) and role = 'athlete' and public.has_valid_group_invite(group_id))
    or ((profile_id = (select auth.uid())) and role = 'coach' and public.is_org_admin_of_group(group_id))
  );
commit;
