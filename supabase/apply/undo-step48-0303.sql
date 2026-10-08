-- UNDO for step 48 (0303). Only if step 48 misbehaves. Puts the rate column back on the roster table with the current values. Note this makes the rates readable by every member of a group again (the problem step 48 fixes).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.group_memberships add column if not exists monthly_rate numeric check (monthly_rate is null or monthly_rate >= 0);
update public.group_memberships gm set monthly_rate = r.monthly_rate from public.client_billing_rates r where r.membership_id = gm.id;
drop table if exists public.client_billing_rates;
commit;
