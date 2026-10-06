-- STEP 13: 0271 database functions are runnable by signed-in users and the server only (not by the public internet), except the three the public pages call
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes. Signed-in people, row security and the server keep working. A signed-out visitor can still open an invite page and still use the discovery-call and gym QR forms (those two are closed later, by step 17, after a deploy). Open the live site signed in as a coach and as a client and check Home, the calendar and one booking.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not (((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')) > 10)) then
    raise exception 'Step 13 (0271) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0271_function_permissions_signed_in_only.sql
-- ====================================================================================================

-- Every function in the public schema could be run by anyone on the internet without signing in (the default when a function is created is
-- "executable by everyone", and Supabase also hands the signed-out role access). That included book_session, complete_workout_session,
-- set_kiosk_pin and verify_kiosk_pin and dozens of helpers. Most check who is calling inside, but a function that forgets (or one written
-- later) would be open to the whole internet. This closes it at the door: functions are no longer runnable by the public or the signed-out
-- role. The signed-in role and the server keep access, so nothing the app does is affected: row security rules call these helper functions as
-- the signed-in person, so they must stay runnable by signed-in users, and they do.
--
-- Three stay open to a signed-out visitor, because public pages call them today:
--   get_invite_info          (the invite page checks a code before anyone has an account)
--   book_discovery_call      (the discovery booking page; moved to a server route in the same release, then closed by 0272)
--   submit_gym_visitor_lead  (the gym QR form; same)
--
-- Also: functions created from now on are NOT runnable by the public or the signed-out role by default. A function a signed-out visitor
-- must call has to be granted to anon on purpose, in its own migration.
-- NOT every function may be handed to the signed-in role: the server-only ones (credit changes, booking settlement, audit writers, SMS and rate-limit
-- bookkeeping, AI metering) have no check of who is calling and were closed on purpose by 0229, 0246, 0247, 0248, 0263, 0267 and 0268. A blanket grant
-- here re-opened them (fixed live by 0282), so this file now skips them: it closes them to the signed-in role instead of opening them. The same list is
-- in 0282 and in supabase/apply/check-function-acl.sql, which fails if a server-only function is ever signed-in-callable again.
-- Re-runnable. Does not touch rls_auto_enable (a database event helper) or functions that belong to an extension.

do $acl$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname = any (array[
      'apply_session_credit_change', 'settle_booking_internal', 'promote_group_waitlist', 'offer_freed_slot_to_waitlist', 'grant_session_credits',
      'rate_limit_hit', 'reserve_ai_call', 'adjust_coach_credits', 'record_sms_stop', 'record_sms_start', 'record_sms_help',
      'sms_consent_for_dispatch', 'audit_record', 'audit_blocked', 'audit_blocked_redacted'
    ]) as server_only
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and p.proname <> 'rls_auto_enable'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    begin
      execute format('revoke execute on function %s from public', r.sig);
      execute format('revoke execute on function %s from anon', r.sig);
      if r.server_only then
        execute format('revoke execute on function %s from authenticated', r.sig);
        execute format('grant execute on function %s to service_role', r.sig);
      else
        execute format('grant execute on function %s to authenticated, service_role', r.sig);
      end if;
    exception when insufficient_privilege then
      raise notice 'skipped % (not owned by this role)', r.sig;
    end;
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('get_invite_info', 'book_discovery_call', 'submit_gym_visitor_lead')
  loop
    execute format('grant execute on function %s to anon', r.sig);
  end loop;
end
$acl$;

-- The public-execute default for new functions is a GLOBAL default (not a per-schema one), so it is revoked globally; the signed-out role's own
-- per-schema default is revoked too. (Signed-in users and the server keep their per-schema defaults.)
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

commit;
