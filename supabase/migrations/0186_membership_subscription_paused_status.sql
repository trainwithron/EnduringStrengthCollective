-- Correctness fix, not the pause feature itself (subscription_pause_
-- mechanics_research.md, RESOLVED 2026-09-14, piece one of two). Stripe
-- can report a subscription's status as 'paused' (customer.subscription.
-- paused/.resumed webhook events, or a trial that ends with no payment
-- method) — this CHECK constraint has always rejected that value, and
-- the webhook's blind status cast would either write the wrong thing
-- ('active') or fail the upsert outright, silently leaving a paused
-- member's row reading 'active' and counting toward MRR.
alter table public.membership_subscriptions drop constraint membership_subscriptions_status_check;
alter table public.membership_subscriptions add constraint membership_subscriptions_status_check
  check (status in ('active', 'past_due', 'canceled', 'incomplete', 'paused'));

-- Nullable, never fabricated — Stripe only exposes a real resume date
-- under pause_collection.resumes_at (a *different* mechanism that never
-- sets status to 'paused' at all per Stripe's own docs), not on a
-- genuinely paused subscription. Populated defensively if that field is
-- ever present; left null otherwise rather than guessing.
alter table public.membership_subscriptions add column paused_until date;
