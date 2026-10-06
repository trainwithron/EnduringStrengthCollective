-- STEP 03: 0259 ongoing weekly series, 0260 payment holds and re-up reminders, 0261 public booking page tables, 0262 job monitoring
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Weekly schedules can run with no end date; the Needs payment panel gets Hold and Remind; a coach can switch on a public booking page; scheduled jobs start recording their runs.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ====================================================================================================
-- migration 0259_booking_series_ongoing.sql
-- ====================================================================================================

-- Recurring sessions that can run with no end, be paused, ended and extended, and are kept booked a rolling 12 weeks ahead.
--
-- A series used to be a fixed count (up to 52 after 0248) booked all at once. This keeps that and adds:
--   * mode 'ongoing': no end date; a daily job books the next 12 weeks (window_weeks) so the calendar is never empty ahead.
--   * paused / ended: a paused series books nothing new; an ended one is finished. Future sessions are cancelled by the app.
--   * skipped_starts: weeks the coach removed or moved on purpose, so the daily top-up never books them back.
--   * anchor_date + timezone: the first session's local date and the coach's zone, so "6:00 every Tuesday" stays 6:00
--     across daylight saving when more weeks are booked later.
-- The series row is only ever written by the server (service role) after it checks the caller coaches the group; clients
-- and coaches still have no direct write policy, same as before. Requires 0210 and 0248.

alter table public.recurring_booking_series
  add column if not exists mode text not null default 'fixed',
  add column if not exists timezone text,
  add column if not exists anchor_date date,
  add column if not exists window_weeks int not null default 12,
  add column if not exists ends_on date,
  add column if not exists skipped_starts timestamptz[] not null default '{}',
  add column if not exists paused_at timestamptz,
  add column if not exists paused_remaining int,
  add column if not exists last_topped_up_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_mode_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_mode_check check (mode in ('fixed', 'ongoing'));

alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_window_weeks_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_window_weeks_check check (window_weeks between 1 and 52);

-- An ongoing series has no total.
alter table public.recurring_booking_series alter column occurrences_total drop not null;
alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_occurrences_total_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_occurrences_total_check
  check (occurrences_total is null or (occurrences_total > 0 and occurrences_total <= 52));
alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_mode_total_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_mode_total_check
  check (mode = 'ongoing' or occurrences_total is not null);

alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_status_check;
alter table public.recurring_booking_series
  add constraint recurring_booking_series_status_check check (status in ('active', 'paused', 'ended', 'cancelled'));

create index if not exists recurring_booking_series_status_idx on public.recurring_booking_series (status, mode);
create index if not exists bookings_recurring_series_idx on public.bookings (recurring_series_id, start_at)
  where recurring_series_id is not null;

-- ====================================================================================================
-- migration 0260_reup_and_payment_holds.sql
-- ====================================================================================================

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

-- ====================================================================================================
-- migration 0261_public_booking_page.sql
-- ====================================================================================================

-- A coach's public booking page (/book/their-name): anyone can pick a session type and a time without an account.
--
--   * coach_booking_pages: the coach's own address (slug), whether the page is on (off until they switch it on), a headline
--     and intro, and whether prices are shown (off by default).
--   * session_types gains what a visitor needs to see: length, where it happens (in person / online / either), an optional
--     description, an optional DISPLAY price (never charged by this page), whether it is offered publicly (off by default)
--     and an order.
--   * bookings.session_type_id / booked_via: which kind of session, and who booked it (coach, client or the public page).
--   * booking_manage_links: one row per public booking holding the visitor's contact details and the HASH of their private
--     manage link (change or cancel without an account). The link itself is only ever shown to the visitor once and emailed
--     when a sender is set up.
-- A visitor's contact details are never readable by anyone but the coach: there is no anon access to any of these tables.
-- The public pages read and write through the server (service role) only. Requires 0180 and 0210.

create table public.coach_booking_pages (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  slug text not null unique,
  enabled boolean not null default false,
  headline text,
  intro text,
  show_prices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_booking_pages_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
);

alter table public.coach_booking_pages enable row level security;
create policy "coach_booking_pages_coach_manage" on public.coach_booking_pages for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

alter table public.session_types
  add column if not exists duration_minutes int not null default 60 check (duration_minutes between 5 and 480),
  add column if not exists location_kind text not null default 'in_person' check (location_kind in ('in_person', 'online', 'either')),
  add column if not exists location_text text,
  add column if not exists description text,
  add column if not exists display_price_cents int check (display_price_cents is null or display_price_cents >= 0),
  add column if not exists public_visible boolean not null default false,
  add column if not exists sort_order int not null default 0;

alter table public.bookings
  add column if not exists session_type_id uuid references public.session_types(id) on delete set null,
  add column if not exists booked_via text check (booked_via is null or booked_via in ('coach', 'client', 'public_page'));

create table public.booking_manage_links (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  guest_name text not null,
  guest_email text not null,
  guest_phone text,
  note text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index booking_manage_links_coach_email_idx on public.booking_manage_links (coach_id, lower(guest_email));
create index booking_manage_links_booking_idx on public.booking_manage_links (booking_id);

alter table public.booking_manage_links enable row level security;
-- The coach can read the details of people who booked with them. Nobody else, and nobody can write directly.
create policy "booking_manage_links_coach_select" on public.booking_manage_links for select
  to authenticated using (coach_id = (select auth.uid()));

-- ====================================================================================================
-- migration 0262_cron_runs.sql
-- ====================================================================================================

-- One row per scheduled job: when it last ran, whether it worked, and how many runs in a row have failed. Written by the server
-- (service role) every time a job runs; read by the platform admin. The health route and a daily watchdog use it to notice a job
-- that has failed or has stopped running, so a broken reminder or billing job is found by an alert, not by a complaint.
create table public.cron_runs (
  job text primary key,
  last_run_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_status text not null check (last_status in ('ok', 'error')),
  last_error text,
  consecutive_failures int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.cron_runs enable row level security;
create policy "cron_runs_platform_admin_select" on public.cron_runs for select
  to authenticated using (public.is_platform_admin());

commit;
