-- UNDO for step 12 (0270). Only if adding a client to a group, or an owner adding themselves as coach, stops working after step 12. Restores the previous rule (the one 0238 created).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert
  to authenticated
  with check (
    is_group_coach(group_id)
    or ((profile_id = (select auth.uid())) and role = 'coach' and is_org_admin_of_group(group_id))
  );
commit;
