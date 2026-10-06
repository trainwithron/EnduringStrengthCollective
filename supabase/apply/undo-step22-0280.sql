-- UNDO for step 22 (0280). Only if something about session balances or the expiry job misbehaves after step 22. Removes the three override functions, the helper and the two new columns (any holds set are lost; reinstated sessions stay on balances and in the ledger).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.undo_expired_reinstatement(uuid, uuid, integer);
drop function if exists public.reinstate_expired_credits(uuid, uuid, integer, text);
drop function if exists public.set_credit_expiry_hold(uuid, uuid, timestamptz, text);
drop function if exists public.reinstatable_expired_credits(uuid, uuid);
alter table public.coach_booking_policies drop column if exists expiry_heads_up_days;
alter table public.session_credits drop column if exists expiry_hold_until;
commit;
