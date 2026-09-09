-- lib/org-creation.ts's createOrganization() did 4 sequential inserts
-- (organizations -> organization_memberships -> groups ->
-- group_memberships) with no wrapping transaction: if any insert after
-- the first failed, the earlier ones were left committed — an orphan
-- organization with an owner membership but no group, or worse, a group
-- with no coach. A retry (the only thing the UI/route offered on error)
-- couldn't clean that up and would just create ANOTHER partial org
-- alongside it, since the slug always gets a fresh random suffix.
--
-- Wrapping all 4 inserts in one PL/pgSQL function makes them atomic for
-- free — a plpgsql function body runs inside the calling statement's
-- transaction, so any exception (a constraint violation, a bad insert)
-- rolls back everything the function already did.
--
-- This function has two real callers with two different auth contexts,
-- and the authorization check has to match what each one relied on
-- before:
--   1. The admin org-creation form, via the authenticated browser client
--      (organizations_insert_platform_admin required owner_id = auth.uid()
--      and is_platform_admin — reproduced here).
--   2. Self-serve coach signup, via the service-role client — that route
--      already runs with RLS fully bypassed by design (no session exists
--      yet, since the account was just created in the same request) and
--      was never subject to the platform-admin check.
-- auth.uid() alone can't tell these apart from a genuinely anonymous
-- caller hitting this RPC directly — all three have a null auth.uid().
-- auth.role() (the JWT's own role claim) does distinguish them, so the
-- service-role bypass is keyed off that explicitly; anything that's
-- neither an authenticated platform admin nor the service role is
-- rejected outright.
create or replace function public.create_organization_with_group(
  p_name text,
  p_slug text,
  p_starter_group_name text,
  p_owner_id uuid,
  p_button_shape text,
  p_accent_color text,
  p_background_color text,
  p_text_color text,
  p_font_display text,
  p_font_body text
)
returns table (organization_id uuid, group_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_group_id uuid;
begin
  -- auth.uid() is null for BOTH the intended service-role bypass (the
  -- self-serve signup route, which has no user session to check yet) and
  -- a genuinely anonymous caller hitting this RPC directly — auth.uid()
  -- alone can't tell those apart. auth.role() reads the JWT's own role
  -- claim (distinct from the Postgres connection role) and does
  -- distinguish them, so the service-role bypass is keyed off that
  -- explicitly instead of the mere absence of a user id.
  if auth.role() = 'service_role' then
    null; -- self-serve signup: no session exists yet, same as today's RLS bypass for this route
  elsif auth.uid() is not null then
    if auth.uid() <> p_owner_id then
      raise exception 'owner_id must match the calling user';
    end if;
    if not exists (select 1 from public.profiles where id = auth.uid() and is_platform_admin) then
      raise exception 'Only a platform admin can create an organization this way';
    end if;
  else
    raise exception 'Not authorized to create an organization';
  end if;

  insert into public.organizations
    (slug, name, owner_id, button_shape, accent_color, background_color, text_color, font_display, font_body)
  values
    (p_slug, p_name, p_owner_id, p_button_shape, p_accent_color, p_background_color, p_text_color, p_font_display, p_font_body)
  returning id into v_org_id;

  insert into public.organization_memberships (organization_id, profile_id, role)
  values (v_org_id, p_owner_id, 'owner');

  insert into public.groups (name, organization_id, created_by)
  values (p_starter_group_name, v_org_id, p_owner_id)
  returning id into v_group_id;

  insert into public.group_memberships (group_id, profile_id, role)
  values (v_group_id, p_owner_id, 'coach');

  return query select v_org_id, v_group_id;
end;
$$;

grant execute on function public.create_organization_with_group(
  text, text, text, uuid, text, text, text, text, text, text
) to authenticated, service_role;
