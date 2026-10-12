-- RELEASE BN (ADDING A CLIENT WORKS AGAIN: THE CREATOR OF A NEW GROUP CAN SEAT THEMSELVES; RUN ANY TIME, IDEALLY NOW): ONE paste. Steps 108 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 108: Adding a client (and making a team or social group, or moving a client to a new space) now finishes: the coach is seated in the new group. The rule only works for the creator of a group that has no members yet.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BN (adding a client works again: the creator of a new group can seat themselves; run any time, ideally NOW), step 108: 0360 Adding a client works again: the person who has just created a group can seat themselves in it as its coach (a new one-on-one space was refusing its very first membership)
do $g108$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0360 is not already applied (the creator helper does not exist yet)', to_regprocedure('public.group_is_new_and_mine(uuid)') is null),
      ('the membership rule and its helpers exist', to_regprocedure('public.group_closed_to_org_admin_join(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BN (adding a client works again: the creator of a new group can seat themselves; run any time, ideally NOW), step 108 (0360) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g108$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 108 (0360)' as step, '0360 Adding a client works again: the person who has just created a group can seat themselves in it as its coach' as what, not ((to_regprocedure('public.group_is_new_and_mine(uuid)') is null)) as in_place
) as result order by step;
