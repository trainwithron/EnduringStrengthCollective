-- UNDO for step 172 (0420). Only if step 172 misbehaves. Puts both functions back to the text they had and drops the new trigger and function (someone who has never signed in can then be made owner again).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists organization_memberships_guard_owner_role on public.organization_memberships;
drop function if exists public.guard_org_membership_owner_role();
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

  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;
  update public.organization_memberships set role = 'owner'
    where organization_id = p_organization_id and profile_id = p_new_owner_id;
  update public.organization_memberships set role = 'admin'
    where organization_id = p_organization_id and profile_id = v_current_owner;
end;
$function$;
commit;
