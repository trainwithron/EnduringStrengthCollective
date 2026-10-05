-- What the Ask Spot help layer could not answer, so missing phrasings can be added. Written only by the server (the service
-- role); read only by the platform admin. query_text is normalized with client names, emails and numbers removed, and is
-- only kept for questions the layer did not answer. Answered ones keep just the intent ids. No person id is stored.
create table public.nav_query_log (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  role text not null check (role in ('coach', 'athlete')),
  device text not null check (device in ('desktop', 'phone')),
  outcome text not null check (outcome in ('navigate', 'howto', 'unsure', 'data')),
  intent_ids text[] not null default '{}',
  query_text text
);

create index nav_query_log_created_idx on public.nav_query_log (created_at desc);
create index nav_query_log_outcome_idx on public.nav_query_log (outcome, created_at desc);

alter table public.nav_query_log enable row level security;

create policy "nav_query_log_admin_select" on public.nav_query_log for select
  to authenticated using (public.is_platform_admin());
