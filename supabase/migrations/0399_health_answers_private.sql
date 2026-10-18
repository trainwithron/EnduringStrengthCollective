-- 0399: a client's health screening ANSWERS (the PAR-Q+ questions and their yes/no) are read by the client and by the coach of that client's group, and by nobody else unless the organization's OWNER says so.
-- Until now the owner and every admin of an organization could read them with the rest of the intake row, and a coach could read the address and device a waiver was signed from. This closes both:
--   1. client_intake: the column par_q_answers is no longer readable straight from the table by a signed-in person. It is read through health_answers() / health_answers_many(), which answer only for the
--      client themself, a coach of the client's group, or an owner or admin the OWNER has granted (health_access_grants). Every other column (whether the form is done, the birthdate, the signed name) stays
--      readable as before, so an owner or admin still sees "done" or "needs attention" for every client, and sees nothing of the answers.
--   2. legal_acceptances: the columns ip and user_agent are no longer readable from the table by anyone signed in. The one way to read them is legal_acceptance_audit(), for the server only, which writes
--      the read to the audit trail.
-- A client who keeps their records private from the organization stays private from its owner and admins even with a grant.

create table if not exists public.health_access_grants (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);
alter table public.health_access_grants enable row level security;
-- The owner and the admins of an organization can see who has the access; nobody writes from the app (the owner uses set_health_access).
drop policy if exists "health_access_grants_select_org_admin" on public.health_access_grants;
create policy "health_access_grants_select_org_admin" on public.health_access_grants for select
  to authenticated using (public.is_org_owner_or_admin(organization_id));
revoke insert, update, delete on public.health_access_grants from authenticated, anon;

-- Who may read a client's answers. Internal.
create or replace function public._can_read_health_answers(p_group uuid, p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or (
      auth.uid() is not null
      and (
        p_athlete = auth.uid()
        or public.is_group_coach(p_group)
        or exists (
          select 1
          from public.groups g
          join public.health_access_grants h on h.organization_id = g.organization_id and h.profile_id = auth.uid()
          where g.id = p_group
            and public.is_org_owner_or_admin(g.organization_id)
            and not public.is_client_private_from_org(p_group, p_athlete)
        )
      )
    )
$$;
revoke execute on function public._can_read_health_answers(uuid, uuid) from public, anon;
grant execute on function public._can_read_health_answers(uuid, uuid) to authenticated, service_role;

create or replace function public.health_answers(p_athlete uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select ci.par_q_answers
  from public.client_intake ci
  where ci.athlete_id = p_athlete and public._can_read_health_answers(ci.group_id, ci.athlete_id)
$$;
revoke execute on function public.health_answers(uuid) from public, anon;
grant execute on function public.health_answers(uuid) to authenticated, service_role;

create or replace function public.health_answers_many(p_athletes uuid[])
returns table (athlete_id uuid, par_q_answers jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select ci.athlete_id, ci.par_q_answers
  from public.client_intake ci
  where ci.athlete_id = any (p_athletes) and public._can_read_health_answers(ci.group_id, ci.athlete_id)
$$;
revoke execute on function public.health_answers_many(uuid[]) from public, anon;
grant execute on function public.health_answers_many(uuid[]) to authenticated, service_role;

-- The owner (and only the owner) lets an owner or admin of the organization read the clients' answers, or takes it back.
create or replace function public.set_health_access(p_org uuid, p_profile uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.organizations where id = p_org and owner_id = auth.uid()) then
    raise exception 'Only the owner can do that.';
  end if;
  if p_on then
    if not exists (select 1 from public.organization_memberships where organization_id = p_org and profile_id = p_profile and role in ('owner', 'admin')) then
      raise exception 'Choose the owner or an admin of this organization.';
    end if;
    insert into public.health_access_grants (organization_id, profile_id, granted_by) values (p_org, p_profile, auth.uid()) on conflict do nothing;
  else
    delete from public.health_access_grants where organization_id = p_org and profile_id = p_profile;
  end if;
  perform public.audit_record('health_access_grants', p_org::text || ':' || p_profile::text, 'update', jsonb_build_object('event', case when p_on then 'granted' else 'revoked' end, 'by', auth.uid()));
end;
$$;
revoke execute on function public.set_health_access(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_health_access(uuid, uuid, boolean) to authenticated, service_role;

-- A person who stops being an owner or admin loses a grant they held (it would otherwise come back if they were made an admin again).
create or replace function public.drop_health_grant_on_leaving()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.health_access_grants where organization_id = old.organization_id and profile_id = old.profile_id;
  return old;
end;
$$;
revoke execute on function public.drop_health_grant_on_leaving() from public, anon, authenticated;
drop trigger if exists organization_memberships_drop_health_grant on public.organization_memberships;
create trigger organization_memberships_drop_health_grant
  after delete on public.organization_memberships
  for each row execute function public.drop_health_grant_on_leaving();

-- 1. the answers column is no longer readable from the table
revoke select on public.client_intake from authenticated;
grant select (athlete_id, group_id, waiver_signed_name, waiver_accepted, completed_at, created_at, updated_at, date_of_birth) on public.client_intake to authenticated;

-- 2. the address and device of an acceptance are no longer readable from the table
revoke select on public.legal_acceptances from authenticated;
grant select (id, profile_id, document, version, accepted_at, text_snapshot) on public.legal_acceptances to authenticated;

-- The audit path: the server (service key) only. Reading the address and device of someone's acceptances leaves a record in the audit trail.
create or replace function public.legal_acceptance_audit(p_profile uuid)
returns table (document text, version text, accepted_at timestamptz, ip text, user_agent text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;
  perform public.audit_record('legal_acceptances', p_profile::text, 'update', jsonb_build_object('event', 'address_and_device_read'));
  return query select la.document, la.version, la.accepted_at, la.ip, la.user_agent from public.legal_acceptances la where la.profile_id = p_profile order by la.accepted_at;
end;
$$;
revoke execute on function public.legal_acceptance_audit(uuid) from public, anon, authenticated;
grant execute on function public.legal_acceptance_audit(uuid) to service_role;
