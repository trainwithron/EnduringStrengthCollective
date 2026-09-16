-- Zapier's own REST Hooks convention (docs.zapier.com/integrations/build/
-- hook-trigger) — required for any public Zapier integration: Zapier's
-- platform POSTs a subscribe request with a callback URL when a user
-- turns a Zap on, and a matching unsubscribe when they turn it off. This
-- app's own side of that contract — the actual Zapier Developer Platform
-- app definition wrapping these as pickable triggers is a separate,
-- later step, not part of this migration.

-- One API key per coach, generated once via the authenticated
-- /api/coach/api-key route and used as Zapier's bearer auth for every
-- /api/zapier/* call. Stored as a SHA-256 hash, never plaintext — a
-- high-entropy random token doesn't need slow/salted password hashing
-- (brute-forcing a 256-bit token via hash lookup is infeasible
-- regardless of hash speed), but there's no reason to keep the raw
-- value sitting in the database once it's been shown to the coach once.
create table public.coach_api_keys (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  api_key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.coach_api_keys enable row level security;

create policy "coach_api_keys_manage_own" on public.coach_api_keys for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- One row per active Zap subscription. Real event set confirmed with
-- Ron's own gym-partner use case in mind (Coast to Coast's session-
-- credit reconciliation pain point) — package_purchased is the one this
-- specific prospect would actually wire up.
create table public.webhook_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (
    event_type in ('client_added', 'workout_completed', 'pr_hit', 'package_purchased')
  ),
  target_url text not null,
  created_at timestamptz not null default now()
);

create index webhook_subscriptions_coach_event_idx on public.webhook_subscriptions(coach_id, event_type);

alter table public.webhook_subscriptions enable row level security;

create policy "webhook_subscriptions_manage_own" on public.webhook_subscriptions for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- No policy at all for API-key-authenticated access — /api/zapier/*
-- resolves coach_id from the bearer token server-side and reads/writes
-- via the service-role client, the same "no Postgres session, so RLS
-- can't apply" shape as the Stripe webhook handler.

-- Delivery log — audit trail AND the retry queue's own source of truth
-- (lib/webhook-dispatch.ts). Every dispatch attempt gets one row here
-- before the actual outbound POST, same "insert as the record, then act"
-- shape already used for sms_log/credit_purchases, though this one is
-- allowed to be updated in place (attempt_count/status) since a single
-- delivery can retry multiple times, unlike a one-shot SMS send.
create table public.webhook_deliveries (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempt_count int not null default 0,
  last_attempted_at timestamptz,
  created_at timestamptz not null default now()
);

create index webhook_deliveries_subscription_idx on public.webhook_deliveries(subscription_id);
create index webhook_deliveries_retry_idx on public.webhook_deliveries(status) where status = 'failed';

alter table public.webhook_deliveries enable row level security;

create policy "webhook_deliveries_select_own" on public.webhook_deliveries for select
  to authenticated
  using (
    exists (
      select 1 from public.webhook_subscriptions s
      where s.id = webhook_deliveries.subscription_id and s.coach_id = (select auth.uid())
    )
  );
