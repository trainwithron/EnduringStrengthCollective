-- RELEASE N PART 2 (RUN AFTER THE RELEASE CODE IS DEPLOYED: DROPS THE OLD RATE COLUMN): ONE paste. Steps 49, 50 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 49: Nothing visible changes. The old rate column is gone; the rates live only in the coach-only table.
-- AFTER STEP 50: Nothing visible changes by itself. Once payments are on, a coach who buys an AI top-up keeps the unused part from one month to the next; the included monthly AI still refreshes on the 1st. Until this step is run the app uses the bought total and records nothing, so it is safe to run any time after Release N.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release N part 2 (run AFTER the release code is deployed: drops the old rate column), step 49: 0304 What a client pays (part two): drops the old, now empty, rate column from the roster table (anything the old code wrote there since step 48 is copied across first)
do $g49$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('step 48 is applied (client_billing_rates exists)', to_regclass('public.client_billing_rates') is not null),
      ('0304 is not already applied (the old rate column is still on group_memberships)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release N part 2 (run AFTER the release code is deployed: drops the old rate column), step 49 (0304) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g49$;

-- ====================================================================================================
-- migration 0304_drop_roster_monthly_rate.sql
-- ====================================================================================================

-- Part TWO of moving what a client pays off the roster table (see 0303): drops the old group_memberships.monthly_rate column. RUN THIS ONLY AFTER the code that reads the new
-- table (client_billing_rates) is live: code that still selects the old column in the same query as the roster would fail without it.
-- Anything the old code wrote into the old column between 0303 and the deploy is copied across first and wins over the row 0303 made (after 0303 emptied the column, any value in it is a
-- later edit by the old editor), so nothing is lost.
-- Re-runnable: it only does anything while the old column still exists.

do $drop$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate') then
    insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate)
    select gm.id, gm.group_id, gm.profile_id, gm.monthly_rate
    from public.group_memberships gm
    where gm.monthly_rate is not null and gm.monthly_rate <= 100000
    on conflict (membership_id) do update set monthly_rate = excluded.monthly_rate, updated_at = now();
    alter table public.group_memberships drop column monthly_rate;
  end if;
end
$drop$;

-- ===== Release N part 2 (run AFTER the release code is deployed: drops the old rate column), step 50: 0305 AI top-up balance that carries over: a small server-only record of how much of the top-up balance each month used, so a paid top-up is spent after the month's included AI and the rest carries into the next month
do $g50$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('organizations exists', to_regclass('public.organizations') is not null),
      ('step 46 is applied (ai_budget_topups exists)', to_regclass('public.ai_budget_topups') is not null),
      ('0305 is not already applied (ai_topup_draws is not there yet)', to_regclass('public.ai_topup_draws') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release N part 2 (run AFTER the release code is deployed: drops the old rate column), step 50 (0305) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g50$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 49 (0304)' as step, '0304 What a client pays' as what, not ((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'))) as in_place
  union all
  select 'step 50 (0305)' as step, '0305 AI top-up balance that carries over: a small server-only record of how much of the top-up balance each month used' as what, not ((to_regclass('public.ai_topup_draws') is null)) as in_place
) as result order by step;
