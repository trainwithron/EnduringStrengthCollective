-- "Report a problem or suggest something": a short note from anyone signed in, with the page they were on, which device
-- and screen size they used, so a tester's report can be reproduced. Rows are added by the server (service role) so the
-- address and device are real; only the platform admin reads them.
create table if not exists public.feedback_reports (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'problem' check (kind in ('problem', 'idea')),
  message text not null check (length(message) between 1 and 4000),
  page_path text,
  user_agent text,
  viewport text,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_reports_created_idx on public.feedback_reports (created_at desc);

alter table public.feedback_reports enable row level security;
create policy "feedback_reports_select_platform_admin" on public.feedback_reports for select
  to authenticated using (coalesce(public.is_platform_admin(), false));
create policy "feedback_reports_update_platform_admin" on public.feedback_reports for update
  to authenticated using (coalesce(public.is_platform_admin(), false)) with check (coalesce(public.is_platform_admin(), false));
