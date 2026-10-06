-- STEP 14: 0273 guards on groups and organizations: ownership, the platform fee, moving a group, the one-on-one rule
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes for normal use: renaming, branding, focus tag, team mode, switching a group's kind and transferring ownership all still work. An organization admin can no longer make themselves the owner with a plain update, and a coach can no longer move a group to another organization or turn a group of several clients into a one-on-one space.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_trigger where tgname in ('organizations_guard_columns', 'groups_guard_columns')))) then
    raise exception 'Step 14 (0273) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0273_group_and_organization_column_guards.sql
-- ====================================================================================================

-- The update rules on groups and organizations only ask "is the caller a coach / an organization admin", not WHICH columns are changing, so an
-- ordinary update could rewrite things that should only change through a controlled path:
--   * organizations.owner_id: an admin could make themselves the owner (or hand it to anyone) with a plain update, skipping
--     transfer_organization_ownership. platform_fee_pct (the platform's cut) could be set to 0.
--   * groups.organization_id / created_by: a coach could move a group into another organization, or change who created it.
--   * groups.group_kind: a coach could turn a group with several clients into a "one-on-one" space, which the app treats as a single
--     client's private space (and which the deletion safety checks rely on).
-- These BEFORE UPDATE triggers close that for signed-in and signed-out callers. The server (service role) and the SQL editor are not affected.
-- Ordinary updates (rename, branding, focus tag, team mode, switching a group's kind) still work, and transfer_organization_ownership still
-- works: the owner is allowed to hand over ownership, but only to a member of that organization.
-- Re-runnable.

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
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_guard_columns on public.organizations;
create trigger organizations_guard_columns
  before update of owner_id, platform_fee_pct on public.organizations
  for each row execute function public.guard_organization_columns();

create or replace function public.guard_group_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A group cannot be moved to another organization.' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Who created a group cannot be changed.' using errcode = '42501';
  end if;
  if new.group_kind is distinct from old.group_kind and new.group_kind = 'one_on_one'
     and (select count(*) from public.group_memberships gm where gm.group_id = new.id and gm.role = 'athlete') > 1 then
    raise exception 'A one-on-one space holds one client. Move the others out first.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_guard_columns on public.groups;
create trigger groups_guard_columns
  before update of organization_id, created_by, group_kind on public.groups
  for each row execute function public.guard_group_columns();

-- Created after the 0271 sweep when applied in order, so give the new functions the same permissions the sweep gives the rest.
revoke execute on function public.guard_organization_columns() from public, anon;
revoke execute on function public.guard_group_columns() from public, anon;
grant execute on function public.guard_organization_columns() to authenticated, service_role;
grant execute on function public.guard_group_columns() to authenticated, service_role;

commit;
