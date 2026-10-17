-- UNDO for step 149 (0397). Only if step 149 misbehaves. Nothing else depends on it.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists group_memberships_free_tier_limit on public.group_memberships;
drop function if exists public.free_tier_client_headroom(uuid);
create or replace function public.org_billable_clients(p_org_id uuid)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if auth.role() is distinct from 'service_role'
     and not (coalesce(public.is_org_member(p_org_id), false) or coalesce(public.is_platform_admin(), false)) then
    raise exception 'Not authorized';
  end if;

  return (
    select count(distinct m.profile_id)::int
    from public.groups g
    join public.group_memberships m on m.group_id = g.id
    where g.organization_id = p_org_id
      and m.role = 'athlete'
      and m.membership_type = 'training'
      and not exists (
        select 1 from public.organization_memberships om
        where om.organization_id = p_org_id and g.id = any (om.departing_group_ids)
          and exists (select 1 from public.group_memberships a where a.group_id = g.id and a.role = 'athlete' and a.private_from_org)
          and not exists (select 1 from public.group_memberships c where c.group_id = g.id and c.role = 'coach' and c.profile_id <> om.profile_id)
      )
  );
end;
$function$;
drop function if exists public.enforce_free_tier_client_limit();
drop function if exists public._org_training_clients(uuid);
drop function if exists public.org_is_free_tier(uuid);
drop function if exists public.free_tier_clients_enforced();
commit;
