-- platform_flat_fee_revenue_split_scoping_sept19.md — a real record of
-- the platform-level deduction (Stripe's own real processing fee, read
-- from balance_transaction.fee, plus a flat $0.10 to Ron) taken off
-- each revenue-split-eligible transaction BEFORE the existing
-- org/coach percentage split (lib/revenue-splits.ts, unchanged) runs.
--
-- A separate table from revenue_split_transfers, not new columns on it:
-- that table is one row PER COACH per event (unique on
-- (stripe_event_id, coach_id)) — the platform deduction is one amount
-- PER EVENT, computed before any coach's share exists, so it doesn't
-- fit that table's grain. unique(stripe_event_id) here gives this its
-- own idempotency guard, independent of how many (if any) coaches end
-- up with a completed Connect transfer for that same event.
create table public.platform_fee_ledger (
  id uuid primary key default uuid_generate_v4(),
  stripe_event_id text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  gross_amount_cents int not null,
  stripe_processing_fee_cents int not null,
  platform_flat_fee_cents int not null,
  net_amount_cents int not null,
  created_at timestamptz not null default now()
);
create index platform_fee_ledger_organization_id_idx on public.platform_fee_ledger(organization_id);

alter table public.platform_fee_ledger enable row level security;

-- Org owner/admin can see what the platform has taken off their own
-- org's transactions — same visibility level as revenue_split_transfers
-- already grants them over the coach-side splits. No coach-level read
-- (this isn't split per-coach) and no authenticated write policy at
-- all — only the service-role webhook ever inserts here.
create policy "platform_fee_ledger_select_org_owner_admin" on public.platform_fee_ledger for select
  to authenticated using (
    exists (
      select 1 from public.organization_memberships om
      where om.organization_id = platform_fee_ledger.organization_id
        and om.profile_id = (select auth.uid())
        and om.role = any (array['owner'::org_member_role, 'admin'::org_member_role])
    )
  );
