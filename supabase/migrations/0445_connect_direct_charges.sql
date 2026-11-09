-- Client payments as direct charges on each organization's own Stripe account (Ron, Nov 9: "I would never hold any of anybody's money. It would all be through their Stripe.").
-- 1. org_connect_accounts: the one Stripe account that receives an organization's client payments. Only the server reads and writes it.
-- 2. stripe_connected_customers: a Stripe customer belongs to one Stripe account, so a client has one per organization they pay. stripe_customers stays for a coach paying Spotlight.
-- 3. coach_packages.stripe_account_id: which Stripe account the package's product and price live on. Empty means none, or one made on the platform before this; a new one is made at checkout.
-- Nothing existing is changed or removed: the old per-coach account columns, revenue_split_transfers and platform_fee_ledger stay as history. Re-running is safe.

create table if not exists public.org_connect_accounts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  stripe_account_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.org_connect_accounts enable row level security;
revoke all on public.org_connect_accounts from anon, authenticated;

create table if not exists public.stripe_connected_customers (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  stripe_account_id text not null,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, stripe_account_id)
);
alter table public.stripe_connected_customers enable row level security;
revoke all on public.stripe_connected_customers from anon, authenticated;

alter table public.coach_packages add column if not exists stripe_account_id text;
