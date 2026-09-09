-- Real Oura Ring integration on top of the wearable_connections
-- placeholder from 0053: OAuth token storage, daily metric storage, and
-- coach visibility. Oura is the first real wearable provider — it's the
-- only one of the ones scoped (Garmin, Google Health, Apple Watch,
-- Samsung, Amazfit) with a fully self-serve OAuth2 + cloud REST API.

alter table public.wearable_connections drop constraint wearable_connections_provider_check;
alter table public.wearable_connections
  add constraint wearable_connections_provider_check
    check (provider in ('garmin', 'apple_health', 'google_health', 'oura'));

alter table public.wearable_connections
  add column external_user_id text,
  add column status text not null default 'active' check (status in ('active', 'revoked', 'error'));

-- Tokens live in their own table with zero policies granted to
-- `authenticated` — RLS is enabled but nothing is ever permitted, so the
-- browser's Supabase client (which CAN select its own wearable_connections
-- row via the existing "own" policy) can never see a raw access/refresh
-- token. Only the service-role client used by the connect/callback/sync
-- API routes ever reaches this table, bypassing RLS entirely as it always
-- does.
create table public.wearable_oauth_tokens (
  id uuid primary key default uuid_generate_v4(),
  connection_id uuid not null references public.wearable_connections(id) on delete cascade unique,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wearable_oauth_tokens enable row level security;

-- Only steps + sleep score for now — the two fields confirmed against
-- Oura's real v2 response schema (daily_activity.steps, daily_sleep.score).
-- Total sleep duration in minutes lives on a different endpoint; add it as
-- its own metric_type once that endpoint's exact shape is verified.
create table public.wearable_daily_metrics (
  id uuid primary key default uuid_generate_v4(),
  connection_id uuid not null references public.wearable_connections(id) on delete cascade,
  metric_date date not null,
  metric_type text not null check (metric_type in ('steps', 'sleep_score')),
  value numeric not null,
  created_at timestamptz not null default now(),
  unique (connection_id, metric_date, metric_type)
);

create index idx_wearable_daily_metrics_connection on public.wearable_daily_metrics(connection_id);

alter table public.wearable_daily_metrics enable row level security;

-- Writes to wearable_daily_metrics only ever happen from the sync route's
-- service-role client — no authenticated-role insert/update/delete policy
-- exists, intentionally. Reads get the same coach-visibility cascade used
-- everywhere else in this schema (own -> group coach -> org owner/admin ->
-- platform admin), but written as an inline group_memberships join rather
-- than reused via is_group_coach(group_id)/is_org_admin_of_group(group_id):
-- these tables carry only a profile_id, and an athlete can belong to more
-- than one group, so there's no single group_id to hand those helpers.
create policy "wearable_connections_select_own_or_coach"
  on public.wearable_connections for select
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.group_memberships gm_self
      join public.group_memberships gm_target on gm_target.group_id = gm_self.group_id
      where gm_self.profile_id = auth.uid()
        and gm_self.role = 'coach'
        and gm_target.profile_id = wearable_connections.profile_id
    )
    or exists (
      select 1 from public.group_memberships gm_target
      join public.groups g on g.id = gm_target.group_id
      join public.organization_memberships om on om.organization_id = g.organization_id
      where gm_target.profile_id = wearable_connections.profile_id
        and om.profile_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
    or public.is_platform_admin()
  );

create policy "wearable_daily_metrics_select_own_or_coach"
  on public.wearable_daily_metrics for select
  to authenticated
  using (
    exists (
      select 1 from public.wearable_connections c
      where c.id = wearable_daily_metrics.connection_id
        and (
          c.profile_id = auth.uid()
          or exists (
            select 1 from public.group_memberships gm_self
            join public.group_memberships gm_target on gm_target.group_id = gm_self.group_id
            where gm_self.profile_id = auth.uid()
              and gm_self.role = 'coach'
              and gm_target.profile_id = c.profile_id
          )
          or exists (
            select 1 from public.group_memberships gm_target
            join public.groups g on g.id = gm_target.group_id
            join public.organization_memberships om on om.organization_id = g.organization_id
            where gm_target.profile_id = c.profile_id
              and om.profile_id = auth.uid()
              and om.role in ('owner', 'admin')
          )
          or public.is_platform_admin()
        )
    )
  );
