-- Wires the existing revenue-split math (lib/revenue-splits.ts,
-- computeRevenueSplit) to real Stripe Connect Express accounts and
-- transfers. Nothing here changes how a split is CALCULATED — it's the
-- same platform_fee_pct / revenue_share_pct model already built; this
-- is just the "actually move the money" layer that page's own copy
-- ("built to plug straight into Stripe Connect transfers later") was
-- always scoped to need.
alter table public.organization_memberships
  add column stripe_connect_account_id text,
  add column stripe_connect_status text not null default 'not_connected'
    check (stripe_connect_status in ('not_connected', 'pending', 'enabled', 'restricted'));

-- Audit trail + idempotency guard for every real transfer created from a
-- webhook event, same shape as credit_purchases: a Stripe retry of the
-- same event hits the unique constraint instead of double-transferring.
create table public.revenue_split_transfers (
  id uuid primary key default uuid_generate_v4(),
  stripe_event_id text not null,
  coach_id uuid not null references public.profiles(id),
  organization_id uuid not null references public.organizations(id),
  stripe_transfer_id text,
  amount_cents int not null,
  created_at timestamptz not null default now(),
  unique (stripe_event_id, coach_id)
);

create index revenue_split_transfers_coach_id_idx on public.revenue_split_transfers(coach_id);
create index revenue_split_transfers_organization_id_idx on public.revenue_split_transfers(organization_id);

alter table public.revenue_split_transfers enable row level security;

create policy "revenue_split_transfers_select_own_or_owner" on public.revenue_split_transfers for select
  to authenticated
  using (
    coach_id = (select auth.uid())
    or exists (
      select 1 from public.organization_memberships om
      where om.organization_id = revenue_split_transfers.organization_id
        and om.profile_id = (select auth.uid())
        and om.role in ('owner', 'admin')
    )
  );
-- No authenticated insert/update/delete policy — only the service-role
-- webhook ever writes this table, same as credit_purchases.
