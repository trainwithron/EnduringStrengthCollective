-- Shared plumbing for the SMS (Twilio) integration — per-coach opt-in/
-- quiet-hours config, plus an audit + idempotency log every dispatch
-- goes through. See lib/sms-dispatch.ts, the single call point that
-- reads this config and writes this log; no other code path sends SMS.

-- One row per coach (or org owner — anyone this app might text an alert
-- to), keyed by profiles(id). No SMS goes out for a coach with no row
-- or sms_enabled=false — opt-in, not opt-out, matching this app's
-- existing default-safe convention for anything that reaches a client's
-- phone (see 0121_age_gate_parental_consent.sql's own framing).
create table public.coach_sms_config (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  phone text,
  sms_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

alter table public.coach_sms_config enable row level security;

create policy "coach_sms_config_manage_own" on public.coach_sms_config for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- Every outbound SMS this app ever sends gets one row here, inserted
-- BEFORE the actual Twilio call (see lib/sms-dispatch.ts) — the insert
-- itself is the idempotency guard: unique(message_type, reference_id)
-- means a second attempt at the same event (a cron re-tick, a retried
-- request) fails the insert and never reaches Twilio at all, same
-- insert-first-as-guard pattern already used for credit_purchases'
-- stripe_event_id. reference_id is text, not uuid, so it can hold a
-- booking id, or a composite key like "athleteId:groupId:dateKey" for
-- events with no single natural id (attendance nudges, low-credit
-- alerts, which are allowed to recur on a later day).
create table public.sms_log (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  recipient_phone text not null,
  message_type text not null check (
    message_type in ('session_reminder', 'booking_confirmation', 'attendance_nudge', 'low_credit_alert')
  ),
  reference_id text not null,
  body text not null,
  sent_at timestamptz not null default now(),
  unique (message_type, reference_id)
);

create index sms_log_coach_id_idx on public.sms_log(coach_id);

alter table public.sms_log enable row level security;

create policy "sms_log_select_own" on public.sms_log for select
  to authenticated
  using (coach_id = (select auth.uid()));

-- No authenticated insert/update/delete policy at all — only the
-- service-role cron routes and the authenticated-but-server-resolved
-- /api/sms/* routes write this table (via lib/sms-dispatch.ts), same
-- "service-role/API-route only" shape as credit_purchases/
-- subscription_credit_grants.
