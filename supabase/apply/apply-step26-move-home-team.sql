-- STEP 26: move the group The Home Team from Ron's own organization (Enduring Strength Co.) into Coast2Coast Fitness, keeping its programs, history and Ron's coach access
--
-- !! Platform-owner change, one group only. Run the precheck first (every row true). Nothing is deleted. The group keeps its two programs and everything attached to it; only which organization it belongs to changes.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: The Home Team now belongs to Coast2Coast Fitness: it appears under that organization in the business-name menu and no longer under Enduring Strength Co. Ron stays a coach of the group (a normal group membership) and the owner of Coast2Coast Fitness, so he keeps full programming access. The group's programs, workouts and history are unchanged.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((exists (select 1 from public.groups where id = '060017b5-e613-4204-a101-c6a14c3a9630' and organization_id = 'b7318b19-a17e-4412-88f1-51d68fcf026f'))) then
    raise exception 'Step 26 (move-home-team) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- move-home-team: one-time data change
-- ====================================================================================================

-- The Home Team (group 060017b5-e613-4204-a101-c6a14c3a9630) moves from Enduring Strength Co. (b7318b19-a17e-4412-88f1-51d68fcf026f) to Coast2Coast Fitness (e369f4a7-c53a-4532-95d3-f7bd14e40e48).
-- groups.organization_id is the only organization link the group's own data hangs on: its programs, workouts, sessions, invites and memberships are keyed
-- to the GROUP, not to the organization, so they come with it. Organization-wide settings (branding, billing, tags) are the new organization's from now on.
do $move$
declare
  n int;
begin
  update public.groups set organization_id = 'e369f4a7-c53a-4532-95d3-f7bd14e40e48' where id = '060017b5-e613-4204-a101-c6a14c3a9630' and organization_id = 'b7318b19-a17e-4412-88f1-51d68fcf026f';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'The Home Team was not found in Enduring Strength Co., so nothing was moved.';
  end if;
  -- Every coach of the group is a member of the new organization (Ron already owns it, so this adds nobody today).
  insert into public.organization_memberships (organization_id, profile_id, role)
  select 'e369f4a7-c53a-4532-95d3-f7bd14e40e48', gm.profile_id, 'coach' from public.group_memberships gm
  where gm.group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and gm.role = 'coach'
  on conflict (organization_id, profile_id) do nothing;
end
$move$;

commit;
