-- credit_topup_low_tier_monetization_idea.md, locked 2026-09-14/15,
-- confirmed to build 2026-09-30 directly by Ron ("I think AI should
-- have limits unless paid. We discussed a credit system and top ups.").
--
-- This is the COACH's own purchase from the platform (AI access),
-- genuinely distinct from coach_packages/session_credits/
-- membership_subscriptions, which are a coach's CLIENT paying the
-- COACH. Nothing here touches those tables.
--
-- Pricing, locked and unchanged from the original scoping: $5 = 5
-- credits ($1/credit). Program generation = 3 credits. Nutrition plan =
-- 2 credits. Collective Intelligence briefing/overview = 2 credits.
-- "Lift Off" = $5/mo recurring-only, grants 9 credits' worth every
-- cycle (1 program + 2 nutrition plans + 1 CI overview), only available
-- on auto-renew — no permanently-discounted one-time equivalent.

create table public.coach_credits (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  balance int not null default 0,
  -- A coach who already existed before this shipped is grandfathered
  -- with unlimited AI access rather than suddenly hitting a 0-credit
  -- wall for a feature they already used freely — the same
  -- never-retroactive backfill pattern already used twice in this
  -- codebase (profiles.intake_required, minor_consent). A brand-new
  -- coach going forward starts metered by default (this column's
  -- default), matching the locked "free tier = no AI without credits"
  -- rule exactly.
  ai_access_mode text not null default 'metered' check (ai_access_mode in ('metered', 'unlimited')),
  updated_at timestamptz not null default now()
);

-- stripe_customers (0063_stripe_checkout.sql) already maps one Stripe
-- Customer per profile_id, reused across every purchase a person makes
-- in this app — a coach buying their own credits is just another
-- consumer of that same table, no new customer-mapping needed.

create table public.coach_credit_purchases (
  id uuid primary key default uuid_generate_v4(),
  stripe_event_id text not null unique,
  stripe_checkout_session_id text not null,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  credits_purchased int not null check (credits_purchased > 0),
  amount_cents int not null,
  created_at timestamptz not null default now()
);
create index coach_credit_purchases_coach_id_idx on public.coach_credit_purchases(coach_id);

create table public.lift_off_subscriptions (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_subscription_id text not null unique,
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table public.lift_off_credit_grants (
  stripe_event_id text primary key,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  credits_granted int not null check (credits_granted > 0),
  created_at timestamptz not null default now()
);
create index lift_off_credit_grants_coach_id_idx on public.lift_off_credit_grants(coach_id);

alter table public.coach_credits enable row level security;
create policy "coach_credits_select_own" on public.coach_credits for select
  to authenticated using (coach_id = (select auth.uid()));
-- No authenticated insert/update/delete policy at all — every write
-- goes through adjust_coach_credits() below, never a direct table write.

alter table public.coach_credit_purchases enable row level security;
create policy "coach_credit_purchases_select_own" on public.coach_credit_purchases for select
  to authenticated using (coach_id = (select auth.uid()));

alter table public.lift_off_subscriptions enable row level security;
create policy "lift_off_subscriptions_select_own" on public.lift_off_subscriptions for select
  to authenticated using (coach_id = (select auth.uid()));

alter table public.lift_off_credit_grants enable row level security;
create policy "lift_off_credit_grants_select_own" on public.lift_off_credit_grants for select
  to authenticated using (coach_id = (select auth.uid()));

-- Written CORRECTLY from day one with the service_role carve-out
-- (critical_null_auth_bypass_vulnerability_sept30.md's own established
-- fix pattern, and the exact regression that pattern needed a follow-up
-- hotfix for earlier today) — a coach can only ever DECREMENT their own
-- balance (spend); only a service-role caller (the Stripe webhook) can
-- INCREMENT it (grant, from a real completed payment). Mirrors
-- adjust_session_credits's own identical anti-self-grant shape.
create or replace function public.adjust_coach_credits(p_coach_id uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'Not authorized to adjust these credits';
  elsif auth.uid() <> p_coach_id then
    raise exception 'Not authorized to adjust these credits';
  elsif p_delta > 0 then
    raise exception 'Not authorized to add your own credits directly';
  end if;

  insert into public.coach_credits (coach_id, balance, updated_at)
  values (p_coach_id, greatest(0, p_delta), now())
  on conflict (coach_id) do update set
    balance = greatest(0, public.coach_credits.balance + p_delta),
    updated_at = now()
  returning balance into new_balance;

  return new_balance;
end;
$$;

-- One-time backfill: every coach that exists right now (anyone already
-- in organization_memberships) is grandfathered unlimited. Never
-- re-runs for a coach who signs up after this migration — they get the
-- table's own 'metered' default the first time adjust_coach_credits (or
-- the balance-check helper) touches their row.
insert into public.coach_credits (coach_id, balance, ai_access_mode)
select distinct profile_id, 0, 'unlimited'
from public.organization_memberships
on conflict (coach_id) do nothing;
