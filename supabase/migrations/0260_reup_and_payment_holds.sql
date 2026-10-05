-- Running out of sessions: payment holds, reminder bookkeeping, and low-balance alerts that fire once per crossing.
--
--   * payment_hold: the coach marks a client as comped, on a break, or paying another way. A held client is left out of the
--     "needs payment" count and is never reminded.
--   * last_reup_nudge_at: when the coach last reminded this client to re-up, so a client is not reminded more than once
--     every 3 days.
--   * low_balance_alert_level: the lowest alert tier already sent to the coach (3, 1 or 0 left), cleared when the balance
--     goes back above 3. This is what makes "3 left / 1 left / 0 left" alert once each per crossing instead of repeating.
--   * coach_booking_policies.reup_nudges_enabled: a coach-wide switch for the reminders, on by default.
-- All additive. Written by the server only (the app checks the caller coaches the group). Requires 0246.

alter table public.session_credits
  add column if not exists payment_hold boolean not null default false,
  add column if not exists last_reup_nudge_at timestamptz,
  add column if not exists low_balance_alert_level smallint
    check (low_balance_alert_level is null or low_balance_alert_level in (0, 1, 3));

alter table public.coach_booking_policies
  add column if not exists reup_nudges_enabled boolean not null default true;

create index if not exists session_credits_needs_payment_idx on public.session_credits (group_id)
  where balance <= 0 and not payment_hold;
