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
