-- STEP 149: 0397 Release F2: the free plan's client limit (15 training clients), installed SWITCHED OFF
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes at all: the limit is installed switched off (free_tier_clients_enforced returns false), so every organization behaves exactly as before. It is switched on later, together with billing, by one more short step. Safe to run before or after the code.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_trigger where tgname = 'group_memberships_free_tier_limit' and not tgisinternal))) then
    raise exception 'Step 149 (0397) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0397_free_tier_client_limit.sql
-- ====================================================================================================

-- 0397: the free plan's client limit (Ron, Oct 17): a coach whose trial ended with no paid plan can keep every client they have, but cannot ADD more than 15 training clients. Nothing is deleted and nobody is
-- locked out; only a new training client beyond the 15th is refused, by the database, so no screen or route can slip past it.
--
-- INSTALLED SWITCHED OFF. free_tier_clients_enforced() returns false, so every organization behaves exactly as before. It is switched on, together with the COACH_BILLING_ENFORCED setting, by replacing that one
-- function with "select true" (and back by putting "select false" again). org_is_free_tier() mirrors lib/org-entitlements.ts: not a founding (billing_exempt) organization, no active or trialing subscription,
-- not past due, and either the trial has ended or the plan lapsed (a canceled plan is free tier only after the period paid for).

create or replace function public.free_tier_clients_enforced()
returns boolean
language sql
stable
set search_path = public
as $$ select false $$;
revoke execute on function public.free_tier_clients_enforced() from public, anon;
grant execute on function public.free_tier_clients_enforced() to authenticated, service_role;

-- Is this organization on the free plan right now? Internal.
create or replace function public.org_is_free_tier(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not coalesce(b.billing_exempt, false)
    and case
      when b.subscription_status in ('active', 'trialing') then false
      when b.subscription_status = 'past_due' then false
      when b.subscription_status = 'canceled' then coalesce(b.current_period_end, '-infinity'::timestamptz) <= now()
      when b.subscription_status in ('unpaid', 'paused', 'incomplete_expired') then true
      else coalesce(b.trial_ends_at, o.created_at + interval '42 days') <= now()
    end
  from public.organizations o
  left join public.organization_billing b on b.organization_id = o.id
  where o.id = p_org
$$;
revoke execute on function public.org_is_free_tier(uuid) from public, anon, authenticated;
grant execute on function public.org_is_free_tier(uuid) to service_role;

-- How many different training clients the organization has (the same count the bill uses). Internal.
create or replace function public._org_training_clients(p_org uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct m.profile_id)::int
  from public.groups g
  join public.group_memberships m on m.group_id = g.id
  where g.organization_id = p_org and m.role = 'athlete' and m.membership_type = 'training'
$$;
revoke execute on function public._org_training_clients(uuid) from public, anon, authenticated;
grant execute on function public._org_training_clients(uuid) to service_role;

create or replace function public.enforce_free_tier_client_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if not public.free_tier_clients_enforced() then
    return new;
  end if;
  -- only a NEW training client counts: a coach, a social-only member, or someone already a training client here changes nothing
  if new.role is distinct from 'athlete' or new.membership_type is distinct from 'training' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.role = 'athlete' and old.membership_type = 'training' then
    return new;
  end if;
  select organization_id into v_org from public.groups where id = new.group_id;
  if v_org is null or not public.org_is_free_tier(v_org) then
    return new;
  end if;
  if exists (
    select 1 from public.group_memberships m join public.groups g on g.id = m.group_id
    where g.organization_id = v_org and m.profile_id = new.profile_id and m.role = 'athlete' and m.membership_type = 'training' and m.id is distinct from new.id
  ) then
    return new;
  end if;
  if public._org_training_clients(v_org) >= 15 then
    -- a person joining on their own is never told about the coach's plan
    raise exception '%', case when new.profile_id = auth.uid() then 'This coach cannot take on new clients right now.' else 'Your free plan includes up to 15 clients. Subscribe to add more.' end;
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_free_tier_client_limit() from public, anon, authenticated;

drop trigger if exists group_memberships_free_tier_limit on public.group_memberships;
create trigger group_memberships_free_tier_limit
  before insert or update of role, membership_type on public.group_memberships
  for each row execute function public.enforce_free_tier_client_limit();

commit;
