-- UNDO for step 22 (0280). Only if something about session balances or the expiry job misbehaves after step 22. It refuses (changes nothing) while any client still has expiry on hold, because removing the hold column would let their sessions expire at the next nightly run: clear the holds first. Otherwise it removes the three override functions, the helper, and the two new columns, and puts the audit trigger back. The give-back record table (session_credit_reinstatements) is KEPT on purpose, so applying step 22 again later can never let the same expired sessions be given back twice (reinstated sessions stay on balances and in the ledger).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $undo$
begin
  if exists (select 1 from public.session_credits where expiry_hold_until > now()) then
    raise exception 'Some clients still have expiry on hold. Removing step 22 now would let their sessions expire at the next nightly run. Clear those holds first, or leave step 22 in place. Nothing was changed.';
  end if;
end
$undo$;
drop function if exists public.undo_expired_reinstatement(uuid, uuid, integer);
drop function if exists public.reinstate_expired_credits(uuid, uuid, integer, text);
drop function if exists public.set_credit_expiry_hold(uuid, uuid, timestamptz, text);
drop function if exists public.reinstatable_expired_credits(uuid, uuid);
drop trigger if exists session_credits_audit on public.session_credits;
create trigger session_credits_audit after insert or update on public.session_credits
  for each row execute function public.audit_watch('balance,payment_hold', 'insert_too', 'athlete_id,group_id');
alter table public.coach_booking_policies drop column if exists expiry_heads_up_days;
alter table public.session_credits drop column if exists expiry_hold_until;
commit;
