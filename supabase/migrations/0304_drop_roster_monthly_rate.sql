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
