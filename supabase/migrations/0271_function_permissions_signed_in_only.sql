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
-- Re-runnable. Does not touch rls_auto_enable (a database event helper) or functions that belong to an extension.

do $acl$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
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
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
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
