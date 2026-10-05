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
