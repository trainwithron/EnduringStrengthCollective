-- Coach subscription billing, phase 1: the data model only. Nothing here
-- charges anyone and nothing reads it for enforcement yet (that is gated
-- behind COACH_BILLING_ENFORCED in the app, default off).
--
-- The BILLING ENTITY is the organization. A missing row means "a normal,
-- non-exempt org on its free trial" — the trial length is a single
-- constant in lib/coach-plan-pricing.ts (TRIAL_DAYS), so trial_ends_at is
-- only stored when something overrides it. Existing organizations are
-- backfilled below as billing_exempt (the grandfathered accounts).

create table public.organization_billing (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Grandfathered / internal accounts: full features, never charged.
  billing_exempt boolean not null default false,
  exempt_reason text,
  -- Overrides created_at + TRIAL_DAYS when set (e.g. a trial reset at launch).
  trial_ends_at timestamptz,
  -- Mirrors of Stripe state, written only by the service-role webhook in
  -- phase 2. Nothing populates these in phase 1.
  stripe_customer_id text,
  stripe_subscription_id text unique,
  subscription_status text check (
    subscription_status in (
      'trialing', 'active', 'past_due', 'canceled', 'incomplete',
      'incomplete_expired', 'unpaid', 'paused'
    )
  ),
  current_period_end timestamptz,
  org_addon boolean not null default false,
  org_addon_until timestamptz, -- add-on stays usable until period end after removal
  past_due_since timestamptz,
  billed_steps int,
  billed_seats int,
  updated_at timestamptz not null default now()
);

alter table public.organization_billing enable row level security;

-- Every member of the org can see their own plan state; only the platform
-- admin can write from the app (the exempt toggle). The Stripe webhook
-- uses the service role, which bypasses RLS.
create policy "organization_billing_select_member_or_admin" on public.organization_billing for select
  to authenticated
  using (coalesce(public.is_org_member(organization_id), false) or coalesce(public.is_platform_admin(), false));

create policy "organization_billing_write_platform_admin" on public.organization_billing for all
  to authenticated
  using (coalesce(public.is_platform_admin(), false))
  with check (coalesce(public.is_platform_admin(), false));

-- Grandfather every organization that exists today.
insert into public.organization_billing (organization_id, billing_exempt, exempt_reason)
select id, true, 'Existing account at billing launch'
from public.organizations
on conflict (organization_id) do nothing;

-- Billable clients: distinct athletes with a TRAINING membership in any
-- group of the org (social-only members and coaches are free). Same
-- definition as coach_client_steps(), but across the whole org instead of
-- one coach's groups, because the plan is billed per organization.
create or replace function public.org_billable_clients(p_org_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
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
  );
end;
$$;

-- Coach seats: everyone on the org's roster (owner / admin / coach). The
-- base price includes the first one.
create or replace function public.org_coach_seats(p_org_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not (coalesce(public.is_org_member(p_org_id), false) or coalesce(public.is_platform_admin(), false)) then
    raise exception 'Not authorized';
  end if;

  return (
    select count(distinct profile_id)::int
    from public.organization_memberships
    where organization_id = p_org_id
  );
end;
$$;

revoke execute on function public.org_billable_clients(uuid) from public, anon;
revoke execute on function public.org_coach_seats(uuid) from public, anon;
grant execute on function public.org_billable_clients(uuid) to authenticated, service_role;
grant execute on function public.org_coach_seats(uuid) to authenticated, service_role;
