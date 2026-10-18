-- RELEASE OWN1 (OWNERSHIP CANNOT BE HANDED TO SOMEONE WHO HAS NOT ACCEPTED THEIR INVITATION; REPLACES ONE FUNCTION): ONE paste. Steps 172 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 172: An owner (or a platform admin) who tries to transfer ownership to someone who has never accepted their invitation and signed in is told so in plain words and nothing changes. Everything else about transferring ownership is as before.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release OWN1 (ownership cannot be handed to someone who has not accepted their invitation; replaces one function), step 172: 0420 Release OWN1: ownership of an organization cannot be handed to someone who has not accepted their invitation
do $g172$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0420 is not already applied (the function does not mention an unaccepted invitation yet)', not exists (select 1 from pg_proc where proname = 'transfer_organization_ownership' and pronamespace = 'public'::regnamespace and prosrc like '%has not accepted their invitation%')),
      ('the function it replaces exists', to_regprocedure('public.transfer_organization_ownership(uuid, uuid)') is not null),
      ('the account columns it reads exist', (select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name in ('invited_at', 'email_confirmed_at', 'last_sign_in_at')) = 3)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release OWN1 (ownership cannot be handed to someone who has not accepted their invitation; replaces one function), step 172 (0420) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g172$;

-- ====================================================================================================
-- migration 0420_transfer_ownership_accepted_only.sql
-- ====================================================================================================

-- Release OWN1: ownership of an organization cannot be handed to someone who has not accepted their invitation.
-- transfer_organization_ownership only checked that the new owner was a member and not leaving, so an invited coach who had never signed in could be made the owner. It now also refuses a person whose account is still an
-- unaccepted invitation, by the same rule as the Invitations list (lib/coach-invite-server.ts isUnaccepted): our invitation marker is on the account (invited_at) and it has never been confirmed (email_confirmed_at) or
-- signed in (last_sign_in_at). The server key is still allowed through (it has no signed-in person and is how support acts). Everything else is exactly as it was (migration 0396): the owner or a platform admin
-- may transfer, not to the current owner, the new owner must be a member and not leaving, the old owner becomes an admin. Replaces one function. Re-runnable.
create or replace function public.transfer_organization_ownership(p_organization_id uuid, p_new_owner_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current_owner uuid;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'Not authorized to transfer organization ownership';
  end if;

  select owner_id into v_current_owner from public.organizations where id = p_organization_id;
  if v_current_owner is null then
    raise exception 'Organization not found';
  end if;

  if v_current_owner <> auth.uid()
     and not exists (select 1 from public.profiles where id = auth.uid() and is_platform_admin)
  then
    raise exception 'Only the current owner or a platform admin can transfer ownership';
  end if;

  if p_new_owner_id = v_current_owner then
    raise exception 'That person already owns this organization';
  end if;

  if not exists (
    select 1 from public.organization_memberships
    where organization_id = p_organization_id and profile_id = p_new_owner_id
  ) then
    raise exception 'The new owner must already be a member of this organization';
  end if;

  if exists (
    select 1 from public.organization_memberships
    where organization_id = p_organization_id and profile_id = p_new_owner_id and departing_since is not null
  ) then
    raise exception 'That coach is leaving this organization and cannot be made its owner.';
  end if;

  -- Someone who has not accepted their invitation cannot own the organization (the server key, which is how support acts, is not held to this).
  if coalesce(auth.role(), '') <> 'service_role' and exists (
    select 1 from auth.users u
    where u.id = p_new_owner_id and u.invited_at is not null and u.email_confirmed_at is null and u.last_sign_in_at is null
  ) then
    raise exception 'That person has not accepted their invitation yet. Ask them to sign in first.';
  end if;

  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;
  update public.organization_memberships set role = 'owner'
    where organization_id = p_organization_id and profile_id = p_new_owner_id;
  update public.organization_memberships set role = 'admin'
    where organization_id = p_organization_id and profile_id = v_current_owner;
end;
$function$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 172 (0420)' as step, '0420 Release OWN1: ownership of an organization cannot be handed to someone who has not accepted their invitation' as what, not ((not exists (select 1 from pg_proc where proname = 'transfer_organization_ownership' and pronamespace = 'public'::regnamespace and prosrc like '%has not accepted their invitation%'))) as in_place
) as result order by step;
