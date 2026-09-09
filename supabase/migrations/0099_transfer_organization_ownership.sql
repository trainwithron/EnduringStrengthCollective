-- organizations_update_owner's own with check (owner_id = auth.uid())
-- means the current owner is the only one who could even attempt an
-- update, but the moment they try to actually change owner_id to
-- someone else, the same check rejects the result — the new row's
-- owner_id no longer equals auth.uid(). Ownership transfer was
-- structurally impossible through this policy, not just unbuilt.
--
-- A SECURITY DEFINER function bypasses that flawed check and implements
-- its own correct authorization instead: the current owner (or a
-- platform admin, same authorization level already used for org
-- creation) can transfer to anyone already a member of this
-- organization — never to an outsider with no existing relationship to
-- it. The previous owner is demoted to admin rather than losing access
-- outright; the new owner's own membership role becomes owner. Both
-- updates happen in one atomic call, same reasoning as
-- create_organization_with_group (migration 0096).
create or replace function public.transfer_organization_ownership(
  p_organization_id uuid,
  p_new_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_owner uuid;
begin
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

  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;
  update public.organization_memberships set role = 'owner'
    where organization_id = p_organization_id and profile_id = p_new_owner_id;
  update public.organization_memberships set role = 'admin'
    where organization_id = p_organization_id and profile_id = v_current_owner;
end;
$$;

grant execute on function public.transfer_organization_ownership(uuid, uuid) to authenticated;
