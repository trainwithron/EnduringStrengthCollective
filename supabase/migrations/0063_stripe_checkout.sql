-- Stripe Checkout: one-time session-credit packs + recurring monthly
-- memberships. One Stripe account (the org owner's own), not Connect —
-- multi-coach payout splits are a deliberate fast-follow, not part of
-- this pass. See the "Stripe Checkout" plan for full context.

-- One Stripe Customer per person, reused across every group/org they're
-- in — created lazily on their first checkout, not eagerly for everyone.
create table public.stripe_customers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.stripe_customers enable row level security;
create policy "stripe_customers_select_own" on public.stripe_customers for select
  to authenticated using (profile_id = auth.uid());
-- No authenticated insert/update/delete policy at all — only the
-- service-role checkout/webhook routes ever write this table.

-- Audit trail for every completed credit-pack purchase, and the
-- idempotency guard for the webhook: Stripe redelivers events on any
-- non-2xx response, and stripe_event_id's unique constraint turns a
-- redelivery into a harmless duplicate-key error instead of a double
-- credit.
create table public.credit_purchases (
  id uuid primary key default uuid_generate_v4(),
  stripe_event_id text not null unique,
  stripe_checkout_session_id text not null,
  athlete_id uuid not null references public.profiles(id),
  group_id uuid not null references public.groups(id),
  credits_purchased int not null check (credits_purchased > 0),
  amount_cents int not null,
  created_at timestamptz not null default now()
);
alter table public.credit_purchases enable row level security;
create policy "credit_purchases_select_own_or_coach" on public.credit_purchases for select
  to authenticated using (athlete_id = auth.uid() or public.is_group_coach(group_id));

-- Mirrors Stripe's own subscription lifecycle per (athlete, group) so the
-- app can show/gate on status without calling Stripe on every page load.
create table public.membership_subscriptions (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  stripe_subscription_id text not null unique,
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, group_id)
);
alter table public.membership_subscriptions enable row level security;
create policy "membership_subscriptions_select_own_or_coach" on public.membership_subscriptions for select
  to authenticated using (athlete_id = auth.uid() or public.is_group_coach(group_id));
