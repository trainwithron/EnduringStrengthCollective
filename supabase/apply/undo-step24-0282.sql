-- UNDO for step 24 (0282). Only if something that used to work for a signed-in person stops working after step 24 (it should not: the app calls these only from the server). It gives the signed-in role access to these functions again, which is the OPEN state step 13 left, so run it only to diagnose and tell Spot straight away.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
grant execute on function public.apply_session_credit_change(uuid, uuid, integer, text, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.settle_booking_internal(uuid, integer, text, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.promote_group_waitlist(uuid) to authenticated, service_role;
grant execute on function public.offer_freed_slot_to_waitlist(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.grant_session_credits(uuid, uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to authenticated, service_role;
grant execute on function public.reserve_ai_call(uuid, uuid, text, boolean, integer, text[], integer) to authenticated, service_role;
grant execute on function public.adjust_coach_credits(uuid, integer) to authenticated, service_role;
grant execute on function public.record_sms_stop(text) to authenticated, service_role;
grant execute on function public.record_sms_start(text) to authenticated, service_role;
grant execute on function public.record_sms_help(text) to authenticated, service_role;
grant execute on function public.sms_consent_for_dispatch(uuid, text) to authenticated, service_role;
grant execute on function public.audit_record(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.audit_blocked(text, text, jsonb, jsonb, text[]) to authenticated, service_role;
grant execute on function public.audit_blocked_redacted(text, text, jsonb, jsonb, text[], text[]) to authenticated, service_role;
commit;
