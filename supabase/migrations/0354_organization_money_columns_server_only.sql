-- Release BF: walling off the money settings on organization memberships.
-- 1. The Stripe columns on a membership (the connected account id and its status) can be written ONLY by the server. Until now an organization's owner could put their own connected account on a coach's
--    membership and so redirect that coach's revenue-share transfers to themselves. A coach connects only their own account, through the Connect onboarding route (service role). The owner can still change
--    a member's role and revenue share, and nothing else on the row.
-- 2. The shares in one organization can never add up to more than 100%. The database refuses it, in plain words.
-- 3. A new organization's owner starts with the whole share (100%) instead of 0%, so the owner is not paid nothing by default.
revoke insert, update on public.organization_memberships from authenticated, anon;
grant update (role, revenue_share_pct) on public.organization_memberships to authenticated;

create or replace function public.guard_organization_share_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_others numeric;
begin
  -- A new owner with nothing yet set, in an organization where nobody has a share, starts with the whole share.
  if tg_op = 'INSERT' and new.role = 'owner' and coalesce(new.revenue_share_pct, 0) = 0
     and not exists (select 1 from public.organization_memberships m where m.organization_id = new.organization_id and m.revenue_share_pct > 0) then
    new.revenue_share_pct := 100;
  end if;
  if tg_op = 'UPDATE' and new.revenue_share_pct is not distinct from old.revenue_share_pct then
    return new;
  end if;
  select coalesce(sum(m.revenue_share_pct), 0) into v_others
  from public.organization_memberships m
  where m.organization_id = new.organization_id and m.id is distinct from new.id;
  if v_others + coalesce(new.revenue_share_pct, 0) > 100 then
    raise exception using message = 'These shares add up to more than 100%. Lower one to save.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_organization_share_total() from public, anon, authenticated;

drop trigger if exists organization_memberships_share_total on public.organization_memberships;
create trigger organization_memberships_share_total
  before insert or update of revenue_share_pct on public.organization_memberships
  for each row execute function public.guard_organization_share_total();
