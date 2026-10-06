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
