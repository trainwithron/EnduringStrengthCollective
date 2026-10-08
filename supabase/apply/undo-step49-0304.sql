-- UNDO for step 49 (0304). Only if step 49 misbehaves. Puts the old rate column back with the current rates (which makes them readable by every group member again, so follow it with step 48's undo only if you mean to go all the way back).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.group_memberships add column if not exists monthly_rate numeric check (monthly_rate is null or monthly_rate >= 0);
update public.group_memberships gm set monthly_rate = r.monthly_rate from public.client_billing_rates r where r.membership_id = gm.id;
commit;
