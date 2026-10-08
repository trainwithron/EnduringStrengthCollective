-- STEP 50: 0305 AI top-up balance that carries over: a small server-only record of how much of the top-up balance each month used, so a paid top-up is spent after the month's included AI and the rest carries into the next month
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes by itself. Once payments are on, a coach who buys an AI top-up keeps the unused part from one month to the next; the included monthly AI still refreshes on the 1st. Until this step is run the app uses the bought total and records nothing, so it is safe to run any time after Release N.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.ai_topup_draws') is null)) then
    raise exception 'Step 50 (0305) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0305_ai_topup_draws.sql
-- ====================================================================================================

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

commit;
