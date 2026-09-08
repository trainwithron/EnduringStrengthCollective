-- Revenue splits, built internally per the "everything except Stripe
-- Connect" pattern used throughout this app (session credits, client
-- rates, challenge entry fees) — real computation, no real money moves
-- yet. platform_fee_pct is ESN's cut off the top of an org's total
-- revenue; each coach's revenue_share_pct is their cut of what's left
-- after that fee. Owners default to keeping the whole remainder;
-- non-owner coaches default to 0% until the owner explicitly configures
-- a share for them.
alter table public.organizations
  add column platform_fee_pct numeric not null default 10
    check (platform_fee_pct >= 0 and platform_fee_pct <= 100);

alter table public.organization_memberships
  add column revenue_share_pct numeric not null default 0
    check (revenue_share_pct >= 0 and revenue_share_pct <= 100);

update public.organization_memberships set revenue_share_pct = 100 where role = 'owner';

-- Wearable sync — placeholder only per explicit instruction ("not
-- happening immediately"). Table exists so a future real OAuth
-- integration has somewhere to land; nothing in the app writes to this
-- yet, and the UI only shows "coming soon."
create table public.wearable_connections (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('garmin', 'apple_health', 'google_health')),
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, provider)
);

alter table public.wearable_connections enable row level security;

create policy "wearable_connections_own" on public.wearable_connections for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
