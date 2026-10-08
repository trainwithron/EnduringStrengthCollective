-- STEP 49: 0304 What a client pays (part two): drops the old, now empty, rate column from the roster table (anything the old code wrote there since step 48 is copied across first)
--
-- !! Run this ONLY AFTER the release's code is deployed and live: code that still selects the old column in the same query as the roster would stop showing the roster. Step 48 must already be applied.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes. The old rate column is gone; the rates live only in the coach-only table.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'))) then
    raise exception 'Step 49 (0304) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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

commit;
