-- RELEASE OWN1 (OWNERSHIP CANNOT BE HANDED TO SOMEONE WHO HAS NEVER SIGNED IN; REPLACES TWO FUNCTIONS, ADDS ONE FUNCTION AND ONE TRIGGER): ONE paste. Steps 172 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 172: An owner (or a platform admin) who tries to transfer ownership to someone who has never signed in (an invitation nobody has used) is told so in plain words and nothing changes, whether it is done with Transfer ownership or by writing the organization directly. A membership can only become owner for the person the organization names as its owner. Everything else is as before.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release OWN1 (ownership cannot be handed to someone who has never signed in; replaces two functions, adds one function and one trigger), step 172: 0420 Release OWN1: ownership of an organization cannot be handed to someone who has never signed in
do $g172$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0420 is not already applied (the new membership guard is not there yet)', not exists (select 1 from pg_trigger where tgname = 'organization_memberships_guard_owner_role' and not tgisinternal)),
      ('the transfer function is exactly the text this replaces', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '234f41b71d19ee8853dc432b95d7283c' from pg_proc p where p.oid = to_regprocedure('public.transfer_organization_ownership(uuid, uuid)')), false)),
      ('the organization guard is exactly the text this replaces', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'a8c146d8aa8dd143bf9a05b497ccc1f9' from pg_proc p where p.oid = to_regprocedure('public.guard_organization_columns()')), false)),
      ('the function it replaces exists', to_regprocedure('public.transfer_organization_ownership(uuid, uuid)') is not null and to_regprocedure('public.guard_organization_columns()') is not null),
      ('the account columns it reads exist', (select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at') = 1)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release OWN1 (ownership cannot be handed to someone who has never signed in; replaces two functions, adds one function and one trigger), step 172 (0420) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g172$;

-- ====================================================================================================
-- migration 0420_transfer_ownership_accepted_only.sql
-- ====================================================================================================

-- Release OWN1: ownership of an organization cannot be handed to someone who has not signed in.
-- transfer_organization_ownership only checked that the new owner was a member and not leaving, so an invited coach who had never signed in could be made the owner. It now also refuses a person whose account has never
-- signed in (auth.users.last_sign_in_at is empty, or the account cannot be found): "can't transfer ownership until someone is logged in". For ownership that is stricter than the Invitations list, which also counts a
-- confirmed invitation link as accepted: an email link scanner can open a link with no person acting, so only a real sign-in counts here. The server key is still allowed through (it has no signed-in person and is how support acts). Everything else is exactly as it was (migration 0396): the owner or a platform admin
-- may transfer, not to the current owner, the new owner must be a member and not leaving, the old owner becomes an admin.
-- The same refusal is also made at the table, so an owner cannot get round it by writing the organization or a membership row directly: guard_organization_columns (the owner_id change) refuses an unaccepted
-- person, and a new guard on membership roles refuses 'owner' for anyone who is not the organization's owner_id (ownership moves only through the function, which sets owner_id first).
-- Replaces two functions and adds one function and one trigger. Re-runnable.
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

  -- Someone who has never signed in cannot own the organization (the server key, which is how support acts, is not held to this).
  if coalesce(auth.role(), '') <> 'service_role' and not exists (
    select 1 from auth.users u where u.id = p_new_owner_id and u.last_sign_in_at is not null
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

-- The table-level guard on who owns an organization, with the same refusal added (everything else exactly as in 0273).
create or replace function public.guard_organization_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.platform_fee_pct is distinct from old.platform_fee_pct then
    raise exception 'The platform fee can only be changed by the platform.' using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id then
    if not (auth.uid() = old.owner_id or public.is_platform_admin())
       or not exists (select 1 from public.organization_memberships m where m.organization_id = new.id and m.profile_id = new.owner_id) then
      raise exception 'Only the owner can transfer an organization, and only to one of its members.' using errcode = '42501';
    end if;
    if not exists (select 1 from auth.users u where u.id = new.owner_id and u.last_sign_in_at is not null) then
      raise exception 'That person has not accepted their invitation yet. Ask them to sign in first.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- A membership can become 'owner' only for the person the organization names as its owner. The transfer function sets owner_id first and then this role, so it passes; a direct write of the role does not.
create or replace function public.guard_org_membership_owner_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.role = 'owner' and old.role is distinct from 'owner'
     and not exists (select 1 from public.organizations o where o.id = new.organization_id and o.owner_id = new.profile_id) then
    raise exception 'Ownership is handed over with Transfer ownership, not by changing a role.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_org_membership_owner_role() from public, anon, authenticated;
drop trigger if exists organization_memberships_guard_owner_role on public.organization_memberships;
create trigger organization_memberships_guard_owner_role
  before update of role on public.organization_memberships
  for each row execute function public.guard_org_membership_owner_role();

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 172 (0420)' as step, '0420 Release OWN1: ownership of an organization cannot be handed to someone who has never signed in' as what, not ((not exists (select 1 from pg_trigger where tgname = 'organization_memberships_guard_owner_role' and not tgisinternal))) as in_place
) as result order by step;
