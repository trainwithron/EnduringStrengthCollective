-- STEP 108: 0360 Adding a client works again: the person who has just created a group can seat themselves in it as its coach (a new one-on-one space was refusing its very first membership)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Adding a client (and making a team or social group, or moving a client to a new space) now finishes: the coach is seated in the new group. The rule only works for the creator of a group that has no members yet.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.group_is_new_and_mine(uuid)') is null)) then
    raise exception 'Step 108 (0360) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0360_new_group_creator_can_seat_themselves.sql
-- ====================================================================================================

-- Release BN: the person who has just created a group can seat themselves in it as its coach.
-- Adding a client makes a new one-on-one group and then the coach's own membership in it. The membership rule lets an organization admin seat themselves only in a group that is not closed to
-- organization admins, and every one-on-one group is closed (the client's privacy), so the very first membership of a new one-on-one group was always refused ("Couldn't set up their space").
-- The new clause is narrow: the person is the group's creator, the row is their own, the role is coach, and the group has no members yet. Once anyone is in the group the clause answers no,
-- so it cannot be used to join a group later. The same fixes the other places that make a group and then seat their creator (a team or social group, moving a client to a new space).

create or replace function public.group_is_new_and_mine(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Answers only for the creator of an empty group, so it can not be used to look up other groups.
  select exists (
    select 1 from public.groups g
    where g.id = p_group_id
      and g.created_by = auth.uid()
      and not exists (select 1 from public.group_memberships gm where gm.group_id = g.id)
  );
$$;
revoke execute on function public.group_is_new_and_mine(uuid) from public, anon;
grant execute on function public.group_is_new_and_mine(uuid) to authenticated, service_role;

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
    or (
      profile_id = (select auth.uid())
      and role = 'coach'
      and public.group_is_new_and_mine(group_id)
    )
  );

commit;
