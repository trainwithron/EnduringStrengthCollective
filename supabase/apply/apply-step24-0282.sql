-- STEP 24: 0282 URGENT: close again the internal server-only functions that step 13 (0271) opened to every signed-in account (credit changes, booking settlement, audit writers, SMS and rate-limit bookkeeping, AI metering)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes: the app only ever calls these from the server, and the functions people use (book, cancel, finish a workout, give back sessions and the rest) call them as the database owner. Afterwards run check-function-acl.sql: every row must say ok = true.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((has_function_privilege('authenticated', 'public.apply_session_credit_change(uuid, uuid, integer, text, text, uuid, uuid)', 'execute'))) then
    raise exception 'Step 24 (0282) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0282_reclose_internal_functions.sql
-- ====================================================================================================

-- Re-closes the internal, server-only functions that 0271 re-opened to every signed-in account.
--
-- 0271 granted EXECUTE on every public function to the signed-in role, which undid the deliberate closing done earlier by 0229, 0246, 0247, 0248,
-- 0263, 0267 and 0268. The functions below have no check of who is calling inside them (they were built to be called only by the server or by
-- another function), so a signed-in account could call them straight through the API: add or remove session credits for any client, settle or charge
-- any booking, write rows into the audit log, and so on. They are server-only again.
--
-- Nothing in the app calls them from a signed-in person's own session (checked: the only direct callers are server routes that use the service role,
-- app/api/cron/process-booking-waitlist, app/api/stripe/webhook, app/api/twilio/inbound, lib/rate-limit.ts, lib/sms-dispatch.ts and
-- lib/ai-usage-server.ts). The functions that DO face the signed-in person (book_session, cancel_booking_and_refund_credit, complete_workout_session,
-- resolve_late_change, request_booking, reinstate_expired_credits and the rest) are SECURITY DEFINER and call these as their owner, so they keep working.
--
-- The server keeps access to all but the three audit writers, which only trigger functions call (0267 and 0268 closed them to the server too).
-- Re-runnable. The matching change in 0271 stops a re-run of that file from opening them again.

revoke all on function public.apply_session_credit_change(uuid, uuid, int, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_booking_internal(uuid, int, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.promote_group_waitlist(uuid) from public, anon, authenticated;
revoke all on function public.offer_freed_slot_to_waitlist(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.grant_session_credits(uuid, uuid, int, text, text) from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
revoke all on function public.reserve_ai_call(uuid, uuid, text, boolean, integer, text[], integer) from public, anon, authenticated;
revoke all on function public.adjust_coach_credits(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_sms_stop(text) from public, anon, authenticated;
revoke all on function public.record_sms_start(text) from public, anon, authenticated;
revoke all on function public.record_sms_help(text) from public, anon, authenticated;
revoke all on function public.sms_consent_for_dispatch(uuid, text) from public, anon, authenticated;

revoke all on function public.audit_record(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.audit_blocked(text, text, jsonb, jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function public.audit_blocked_redacted(text, text, jsonb, jsonb, text[], text[]) from public, anon, authenticated, service_role;

-- The server keeps what it had (a revoke from "public" never touches a role's own grant, but be explicit so this file is the whole truth).
grant execute on function public.apply_session_credit_change(uuid, uuid, int, text, text, uuid, uuid) to service_role;
grant execute on function public.settle_booking_internal(uuid, int, text, uuid, uuid, uuid) to service_role;
grant execute on function public.promote_group_waitlist(uuid) to service_role;
grant execute on function public.offer_freed_slot_to_waitlist(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.grant_session_credits(uuid, uuid, int, text, text) to service_role;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.reserve_ai_call(uuid, uuid, text, boolean, integer, text[], integer) to service_role;
grant execute on function public.adjust_coach_credits(uuid, integer) to service_role;
grant execute on function public.record_sms_stop(text) to service_role;
grant execute on function public.record_sms_start(text) to service_role;
grant execute on function public.record_sms_help(text) to service_role;
grant execute on function public.sms_consent_for_dispatch(uuid, text) to service_role;

commit;
