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
