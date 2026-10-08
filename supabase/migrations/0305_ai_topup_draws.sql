-- AI top-up balance that carries over (follows 0301). A paid top-up is not tied to the month it was bought in: it goes into the organization's balance, which is spent only AFTER the
-- month's included AI budget is used up, and whatever is left carries into the next month with no expiry. The included budget itself still resets every month.
--
-- The balance is: everything ever bought (ai_budget_topups, 0301) minus what earlier months drew from it, minus this month's use beyond the included budget (worked out live from the
-- usage log). What an earlier month drew is final, so it is kept here: one row per organization and month, written by the server as that month's use passes the included budget.
-- Server only (the table has no policy and no access for signed-in or signed-out users). Until this is pasted the app carries on with the bought total and records nothing.
-- Re-runnable.

create table if not exists public.ai_topup_draws (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  usd_drawn numeric not null check (usd_drawn >= 0 and usd_drawn <= 100000),
  updated_at timestamptz not null default now(),
  primary key (organization_id, month)
);
alter table public.ai_topup_draws enable row level security;
-- No policy at all: only the server (service role) reads or writes it.
revoke all on public.ai_topup_draws from anon, authenticated;
