-- STEP 88: 0342 Private lookups the row rules use can't be asked about other people by any signed-in account (who shares an organization, who blocked whom, who is a client of a group, who is hidden from the organization, a coach's client count)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for normal use: the app's own rules ask these questions only about the signed-in person. Anyone else asking about other people now gets 'no'. The server and the database's own jobs are unaffected.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((has_function_privilege('authenticated', 'public.coach_ai_multiplier(uuid)', 'execute'))) then
    raise exception 'Step 88 (0342) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0342_close_lookup_oracles.sql
-- ====================================================================================================

-- Release AT: helper functions that the row rules call are no longer questions any signed-in person can ask about anyone.
-- Each of these answers a private fact for ANY ids passed in (who shares an organization with whom, who has blocked whom, who is a client of a group, which client is hidden from the
-- organization, how many clients a coach has), and every one is callable from the browser by any signed-in account. Pairing them with the list of all user ids shows a competitor's whole roster.
--   * training_partners_share_org, training_partners_mutually_blocked: answer only when the signed-in person is one of the two (the row rules always pass themselves as one).
--   * is_training_client_of_group: answers only about the signed-in person, or for a coach of that group.
--   * is_client_private_from_org: answers only about the signed-in person, or for a coach, an organization admin of that group, or a platform admin (the only people the row rules ask on behalf of).
--   * is_wearable_subject_private_from_org: same idea for the wearable rules.
--   * coach_ai_multiplier, coach_client_steps: closed to the browser entirely (only the database's own budget functions call them, as the database owner).
-- The server (service role), database jobs and migrations are not affected: for them (not a signed-in browser request) every function answers exactly as before.

create or replace function public.training_partners_share_org(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (coalesce(auth.role(), '') <> 'authenticated' or auth.uid() = a or auth.uid() = b)
    and exists (
      select 1
      from public.group_memberships gm_a
      join public.groups g_a on g_a.id = gm_a.group_id
      join public.group_memberships gm_b on gm_b.profile_id = b
      join public.groups g_b on g_b.id = gm_b.group_id
      where gm_a.profile_id = a
        and g_a.organization_id is not null
        and g_b.organization_id = g_a.organization_id
    );
$function$;

create or replace function public.training_partners_mutually_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (coalesce(auth.role(), '') <> 'authenticated' or auth.uid() = a or auth.uid() = b)
    and exists (
      select 1 from public.training_partner_blocks
      where (blocker_id = a and blocked_id = b)
         or (blocker_id = b and blocked_id = a)
    );
$function$;

create or replace function public.is_training_client_of_group(_group_id uuid, _athlete_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (coalesce(auth.role(), '') <> 'authenticated' or _athlete_id = auth.uid() or public.is_group_coach(_group_id))
    and exists (
      select 1 from public.group_memberships
      where group_id = _group_id
        and profile_id = _athlete_id
        and role = 'athlete'
        and membership_type = 'training'
    );
$function$;

create or replace function public.is_client_private_from_org(_group_id uuid, _athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (coalesce(auth.role(), '') <> 'authenticated' or _athlete_id = auth.uid() or public.is_group_coach(_group_id) or public.is_org_admin_of_group(_group_id) or public.is_platform_admin())
    and coalesce(
      (select private_from_org from public.group_memberships
       where group_id = _group_id and profile_id = _athlete_id),
      false
    );
$function$;

create or replace function public.is_wearable_subject_private_from_org(_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (
      coalesce(auth.role(), '') <> 'authenticated'
      or _profile_id = auth.uid()
      or public.is_platform_admin()
      or exists (
        select 1
        from public.group_memberships gm
        join public.groups g on g.id = gm.group_id
        join public.organization_memberships om on om.organization_id = g.organization_id
        where gm.profile_id = _profile_id and om.profile_id = auth.uid() and om.role in ('owner', 'admin')
      )
    )
    and exists (
      select 1 from public.group_memberships
      where profile_id = _profile_id and private_from_org = true
    );
$function$;

revoke execute on function public.coach_ai_multiplier(uuid) from public, anon, authenticated;
revoke execute on function public.coach_client_steps(uuid) from public, anon, authenticated;

commit;
