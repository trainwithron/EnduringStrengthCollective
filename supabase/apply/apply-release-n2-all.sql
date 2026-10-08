-- RELEASE N PART 2 (RUN AFTER THE RELEASE CODE IS DEPLOYED: DROPS THE OLD RATE COLUMN): ONE paste. Steps 49 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 49: Nothing visible changes. The old rate column is gone; the rates live only in the coach-only table.
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
-- Anything the old code wrote into the old column between 0303 and the deploy is copied across first (rows the new table already has are left alone), so nothing is lost.
-- Re-runnable: it only does anything while the old column still exists.

do $drop$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate') then
    insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate)
    select gm.id, gm.group_id, gm.profile_id, gm.monthly_rate
    from public.group_memberships gm
    where gm.monthly_rate is not null and gm.monthly_rate <= 100000
    on conflict (membership_id) do nothing;
    alter table public.group_memberships drop column monthly_rate;
  end if;
end
$drop$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 49 (0304)' as step, '0304 What a client pays' as what, not ((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'))) as in_place
) as result order by step;
