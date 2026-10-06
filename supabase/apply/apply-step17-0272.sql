-- STEP 17: 0272 the discovery-call and gym QR functions are server-only (ONLY after the release with the two new server routes is deployed)
--
-- !! Do NOT run this until the release that contains /api/public/discovery-book and /api/public/gym-lead is deployed AND step 13 (0271) is applied. If you run it first, the public discovery-call page and the gym QR form show an error until the deploy.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: The two public forms keep working (they now go through our server). Open /book/<a coach id> and the gym QR form once to confirm. A signed-out visitor can no longer call those two database functions directly.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((has_function_privilege('anon', 'public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text)', 'execute'))) then
    raise exception 'Step 17 (0272) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0272_public_forms_only_through_the_server.sql
-- ====================================================================================================

-- The discovery-call booking page and the gym QR lead form now post to server routes (/api/public/discovery-book and /api/public/gym-lead),
-- which check and rate limit the request and then call these two functions with the server's own access. So the functions no longer need to
-- be runnable straight from a browser, signed in or not: closing them stops anyone calling them directly with any coach id, any time, any
-- length, as often as they like.
--
-- APPLY ONLY AFTER the release that contains those two routes is deployed. Applied before that, the two public forms stop working until the
-- deploy (they would fail with "permission denied", and the visitor sees a plain error). Requires 0271 to have been applied first.
do $close$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('book_discovery_call', 'submit_gym_visitor_lead')
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$close$;

commit;
