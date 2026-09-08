-- Lets an organization's owner/admin become a real coach of any group in
-- their own org on demand (the group switcher inserts this row the first
-- time they switch into a group they're not already staffing), instead of
-- requiring every group to be pre-seeded with their membership by hand.
-- Deliberately a real group_memberships row, not a parallel access path —
-- every existing coach-only check in the app (RLS and the page-level
-- `role === "coach"` lookups alike) already keys off this table, so this
-- is the only change needed for full coach access to click through
-- correctly everywhere at once.
--
-- The org-admin check needs a SECURITY DEFINER helper, not an inline join —
-- groups is itself RLS-protected on membership (groups_select_members:
-- is_group_member(id)), and membership is exactly what this policy grants
-- for the first time. An inline join sees zero rows for a group the caller
-- isn't a member of yet, so it always fails. Same pattern is_group_member
-- and is_org_member already use to break this exact kind of cycle.
create or replace function public.is_org_admin_of_group(_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.groups g
    join public.organization_memberships om on om.organization_id = g.organization_id
    where g.id = _group_id
      and om.profile_id = auth.uid()
      and om.role in ('owner', 'admin')
  );
$$;

drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self"
  on public.group_memberships for insert
  to authenticated
  with check (
    public.is_group_coach(group_id)
    or (profile_id = auth.uid() and role = 'athlete')
    or (profile_id = auth.uid() and role = 'coach' and public.is_org_admin_of_group(group_id))
  );
