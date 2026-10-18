-- STEP 158: 0406 Release X2: an athlete no longer reads other athletes' membership rows (a restrictive read rule on group_memberships)
--
-- !! This CHANGES what athletes can read. Apply it ONLY AFTER step 156 is applied AND the Release X1 code is live (the athlete screens that list the group's people must already be using the narrow functions). Applying it earlier makes the @mention lists and the position leaderboard show only the coaches.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: From now on an athlete reads their own membership row and their coaches' rows, and no other athlete's (their tier, level, privacy setting and membership type). Coaches, and an organization's owner or admin, read exactly what they did before. Everything the athlete screens list about the group's people comes through the two narrow functions from step 156. RIGHT AFTER APPLYING, CHECK AS AN ATHLETE (and keep the one-line undo ready): the group Home, the feed with its leaderboard, a post's comments with an @ mention, the games page and messages. If anything shows fewer people than before, run the undo below (it takes effect at once).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'group_memberships_select_narrow'))) then
    raise exception 'Step 158 (0406) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0406_group_memberships_athlete_narrow.sql
-- ====================================================================================================

-- Release X2: an athlete no longer reads other athletes' membership rows.
--
-- Any member of a group could read every column of every membership row of that group (client_tier, training_level, private_from_org, membership_type, history_import_enabled, coach_sets_macros and the rest). The athlete
-- screens that need to list the people in a group now use the narrow functions from migration 0404 (a name, a photo, a role and a position), so this step can close the table.
--
-- A RESTRICTIVE policy is ANDed with the policies that already exist, so it can only take access away. A row stays readable for:
--   - the person it belongs to;
--   - a coach's own row (a client sees who coaches them);
--   - a coach of the group (all the rows of their groups, as before);
--   - an owner or admin of the group's organization (their existing policy still decides which rows, including keeping a client who is private from the organization out of sight).
-- Everything else an athlete used to see (a teammate's tier, level, privacy setting, membership type) is gone. Every other table's policy and function that reads this table either runs as the database (the helper
-- functions are SECURITY DEFINER) or only ever needs the viewer's own row, a coach's row, or is a coach-only rule; the one signed-in-caller function that reads it, assign_program_to_client, is a coach's tool.
-- Selecting only: inserting, updating and deleting are unchanged. Re-runnable.
drop policy if exists "group_memberships_select_narrow" on public.group_memberships;
create policy "group_memberships_select_narrow" on public.group_memberships as restrictive for select to authenticated
  using (
    profile_id = (select auth.uid())
    or role = 'coach'
    or public.is_group_coach(group_id)
    or public.is_org_admin_of_group(group_id)
  );

commit;
