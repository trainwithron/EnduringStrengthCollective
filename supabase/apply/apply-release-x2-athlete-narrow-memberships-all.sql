-- RELEASE X2 (ATHLETES STOP READING OTHER ATHLETES' MEMBERSHIP ROWS; CHANGES ACCESS: APPLY ONLY AFTER STEP 156 AND THE RELEASE X1 CODE): ONE paste. Steps 158 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 158: From now on an athlete reads their own membership row and their coaches' rows, and no other athlete's (their tier, level, privacy setting and membership type). Coaches, and an organization's owner or admin, read exactly what they did before. Everything the athlete screens list about the group's people comes through the two narrow functions from step 156.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release X2 (athletes stop reading other athletes' membership rows; CHANGES access: apply only after step 156 and the Release X1 code), step 158: 0406 Release X2: an athlete no longer reads other athletes' membership rows (a restrictive read rule on group_memberships)
do $g158$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0406 is not already applied (the restrictive read rule is not there yet)', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'group_memberships_select_narrow')),
      ('step 156 is applied (the narrow read functions exist)', to_regprocedure('public.group_member_names(uuid)') is not null and to_regprocedure('public.group_position_roster(uuid)') is not null),
      ('the helpers the rule uses exist', to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release X2 (athletes stop reading other athletes'' membership rows; CHANGES access: apply only after step 156 and the Release X1 code), step 158 (0406) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g158$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 158 (0406)' as step, '0406 Release X2: an athlete no longer reads other athletes'' membership rows' as what, not ((not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'group_memberships_select_narrow'))) as in_place
) as result order by step;
