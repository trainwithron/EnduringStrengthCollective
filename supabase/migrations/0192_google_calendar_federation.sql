-- Google Calendar work/personal federation
-- (google_calendar_federation_feasibility_sept16.md, architecture (a)):
-- one dedicated "<Coach> — Work" Google Calendar per coach, in-app work
-- events (bookings) mirrored into it one-way, then shared back to the
-- coach's personal Google account at freeBusyReader ACL so their real
-- personal calendar shows work as a native opaque busy block — Google's
-- own sharing UI/sync renders that automatically, no custom code needed
-- for that half. Separately, the coach's personal calendar's real event
-- details are read one-way (calendar.events.readonly, folded into the
-- single full `calendar` scope this build requests) and cached here for
-- rendering inside the in-app work Calendar.
--
-- Deliberately its own table set, not reused wearable_connections/
-- wearable_oauth_tokens — this is calendar federation, not a fitness
-- metric source — even though the OAuth2 + service-role-only token
-- pattern below is copied from that shipped Oura design
-- (0090_oura_wearable_integration.sql), per the feasibility doc's own
-- explicit recommendation.

create table public.google_calendar_connections (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null unique references public.profiles(id) on delete cascade,
  work_calendar_id text,
  personal_email text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;

create policy "google_calendar_connections_select_own"
  on public.google_calendar_connections for select
  to authenticated
  using (coach_id = auth.uid());

create policy "google_calendar_connections_delete_own"
  on public.google_calendar_connections for delete
  to authenticated
  using (coach_id = auth.uid());

-- Same zero-authenticated-policy shape as wearable_oauth_tokens — RLS is
-- enabled but nothing is ever granted, so only the service-role client
-- used by the connect/callback/mirror-event/sync routes ever reaches a
-- raw access/refresh token.
create table public.google_calendar_oauth_tokens (
  id uuid primary key default uuid_generate_v4(),
  connection_id uuid not null unique references public.google_calendar_connections(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_oauth_tokens enable row level security;

-- One-way cache of the coach's personal Google Calendar's real event
-- details, refreshed by the daily cron sync (kept once-daily, not the
-- session-reminder cron's 15-minute cadence — vercel_no_autodeploy_gap
-- and tonight's own real Hobby-plan cron rejection are the reason:
-- Hobby accounts reject any cron more frequent than daily at deploy
-- time). Rendered inside the in-app work Calendar so a coach sees real
-- personal commitments without leaving the app.
create table public.google_calendar_personal_events (
  id uuid primary key default uuid_generate_v4(),
  connection_id uuid not null references public.google_calendar_connections(id) on delete cascade,
  external_event_id text not null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (connection_id, external_event_id)
);

create index idx_google_calendar_personal_events_connection on public.google_calendar_personal_events(connection_id);

alter table public.google_calendar_personal_events enable row level security;

create policy "google_calendar_personal_events_select_own"
  on public.google_calendar_personal_events for select
  to authenticated
  using (
    exists (
      select 1 from public.google_calendar_connections c
      where c.id = google_calendar_personal_events.connection_id
        and c.coach_id = auth.uid()
    )
  );

-- Dedup/idempotency for mirroring an in-app booking into the coach's
-- Google work calendar: set the first time a booking is mirrored,
-- reused on reschedule (PATCH the same Google event instead of creating
-- a duplicate), cleared once the mirrored event is deleted on cancel.
alter table public.bookings add column google_calendar_event_id text;
