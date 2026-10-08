-- STEP 48: 0303 What a client pays becomes coach-only (part one): the coach's manual monthly rate moves off the roster table (which every member of a group could read) into its own table that only the group's coaches can read or write (the organization's owner and admins can read it); the existing rates are copied across and the old column is emptied, so the leak is closed at once
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Clients can no longer see what any client pays. The code that is live today still finds the old rate column (now empty) and carries on; the Business estimate shows nothing until the code in the same release is live, then shows the same rates as before. Step 49 (after the deploy) removes the old column.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.client_billing_rates') is null)) then
    raise exception 'Step 48 (0303) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0303_client_rates_coach_only.sql
-- ====================================================================================================

-- What a client pays (the coach's manual "$/mo" estimate) must be seen by the coach only. It lived on group_memberships.monthly_rate (0045), and the roster policy
-- memberships_select_same_group lets EVERY member of a group read EVERY column of every membership row in it, so any client could read what each other client pays.
-- A row policy cannot hide one column, so the rate moves to its own table that only the group's coaches can read or write.
--
--  * client_billing_rates: one row per membership that has a rate. Coaches of the group read and write it; the organization's owner and admins may read it (the Revenue splits
--    total adds it up across the organization); nobody else (not the client, not another client) can see it at all.
-- This is part ONE of two: it creates the table, copies the rates across and EMPTIES the old column (so the leak is closed at once). The old column itself is dropped by 0304 after
-- the code that reads the new table is live; until then the code that is live today still reads the column, finds it empty, and carries on (the Business estimate shows nothing
-- for those minutes, nothing else is affected). Re-runnable: the copy and the emptying only run while the old column exists.

create table if not exists public.client_billing_rates (
  membership_id uuid primary key references public.group_memberships(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  monthly_rate numeric not null check (monthly_rate >= 0 and monthly_rate <= 100000),
  updated_at timestamptz not null default now()
);
create index if not exists client_billing_rates_group_idx on public.client_billing_rates (group_id);

alter table public.client_billing_rates enable row level security;
revoke all on public.client_billing_rates from anon;
revoke truncate, references, trigger on public.client_billing_rates from authenticated;

drop policy if exists "client_billing_rates_coach_all" on public.client_billing_rates;
create policy "client_billing_rates_coach_all" on public.client_billing_rates for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (
    public.is_group_coach(group_id)
    and exists (select 1 from public.group_memberships gm where gm.id = membership_id and gm.group_id = client_billing_rates.group_id and gm.profile_id = client_billing_rates.profile_id)
  );

-- The organization's owner and admins may READ the rates of every group in the organization; they cannot write them.
drop policy if exists "client_billing_rates_org_admin_select" on public.client_billing_rates;
create policy "client_billing_rates_org_admin_select" on public.client_billing_rates for select
  to authenticated
  using (public.is_org_admin_of_group(group_id));

do $copy$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate') then
    -- an amount above 100,000 is not a real rate (the old column allowed any number): it is neither carried over nor kept
    insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate)
    select gm.id, gm.group_id, gm.profile_id, gm.monthly_rate
    from public.group_memberships gm
    where gm.monthly_rate is not null and gm.monthly_rate <= 100000
    on conflict (membership_id) do nothing;
    update public.group_memberships set monthly_rate = null where monthly_rate is not null;
  end if;
end
$copy$;

commit;
