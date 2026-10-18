-- UNDO for step 151 (0399). Only if step 151 misbehaves. It gives the owner and admins their old read of the answers back (and a coach their old read of an acceptance's address and device); run it only if you accept that.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists organization_memberships_drop_health_grant_role on public.organization_memberships;
drop function if exists public.drop_health_grant_on_role_change();
drop trigger if exists organization_memberships_drop_health_grant on public.organization_memberships;
drop function if exists public.drop_health_grant_on_leaving();
-- signed-out visitors get back exactly what they held before
grant delete, insert, references, select, trigger, truncate, update on public.client_intake to anon;
grant insert, select on public.legal_acceptances to anon;
drop function if exists public.legal_acceptance_audit(uuid);
grant select on public.legal_acceptances to authenticated;
grant select on public.client_intake to authenticated;
drop function if exists public.set_health_access(uuid, uuid, boolean);
drop function if exists public.health_answers_many(uuid[]);
drop function if exists public.health_answers(uuid);
drop function if exists public._can_read_health_answers(uuid);
drop table if exists public.health_access_grants;
commit;
