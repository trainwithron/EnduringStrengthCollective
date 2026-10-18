-- UNDO for step 161 (0409). Only if step 161 misbehaves. Run it only while the Release M1 code is not live. The record of failed payments, refunds and disputes is dropped with the table.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.payment_reconciliation_report();
drop table if exists public.payment_events;
-- the extra notification kind is left in the list (removing it could break rows that use it)
commit;
