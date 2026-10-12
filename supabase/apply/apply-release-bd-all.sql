-- RELEASE BD (JOINING AN ORGANIZATION NEEDS THE PERSON'S OK; INVITATIONS AND LEAVE; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 98 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 98: An organization's owner can no longer add an existing person to the organization on their own. A new coach invited by email still joins by setting their password; a person who already has an account gets an invitation they accept or decline. Anyone but the owner can leave. Nothing existing changes.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BD (joining an organization needs the person's OK; invitations and leave; run BEFORE the code that goes with it is live), step 98: 0352 Joining an organization needs the person's OK: an owner can no longer put an existing account into their organization; an invitation is accepted or declined by the person, and any member can leave
do $g98$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0352 is not already applied (the invitations table does not exist yet)', to_regclass('public.organization_invites') is null),
      ('the memberships table has the owner''s insert rule', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_memberships' and policyname = 'org_memberships_insert_owner'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BD (joining an organization needs the person''s OK; invitations and leave; run BEFORE the code that goes with it is live), step 98 (0352) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g98$;

-- ====================================================================================================
-- migration 0352_organization_invites_accept_and_leave.sql
-- ====================================================================================================

-- Release BD: joining an organization needs the person's OK, and they can leave. Until now an organization's owner could insert an organization membership for ANY existing person (the rule
-- org_memberships_insert_owner), putting someone into their organization without asking. That rule is removed: memberships are now made only by the server (a brand-new coach invited by email, who accepts
-- by setting a password), by the organization-creation function, or by the person themselves accepting an invitation. A person who already has an account gets an invitation they accept or decline,
-- and any member can leave (the owner cannot; ownership has to be handed over first).
drop policy if exists "org_memberships_insert_owner" on public.organization_memberships;

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invited_profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'coach')),
  group_id uuid references public.groups(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  answered_at timestamptz,
  accepted boolean
);
create index if not exists organization_invites_invited_idx on public.organization_invites (invited_profile_id) where answered_at is null;
create unique index if not exists organization_invites_one_open on public.organization_invites (organization_id, invited_profile_id) where answered_at is null;
alter table public.organization_invites enable row level security;
revoke all on public.organization_invites from anon;

-- The invited person sees their own invitations; an owner or admin sees their organization's. Making and answering invitations goes through the server and the two functions below.
create policy "organization_invites_select" on public.organization_invites for select to authenticated
  using (invited_profile_id = (select auth.uid()) or public.is_org_owner_or_admin(organization_id));

-- Accept or decline. Accepting makes the organization membership (and the coach seat in the group the invitation named, if any); nobody else can answer for the person.
create or replace function public.answer_organization_invite(p_invite uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.organization_invites%rowtype;
begin
  select * into inv from public.organization_invites where id = p_invite for update;
  if not found or inv.invited_profile_id is distinct from auth.uid() then
    raise exception 'That invitation was not found.';
  end if;
  if inv.answered_at is not null then
    raise exception 'That invitation has already been answered.';
  end if;
  if inv.expires_at < now() then
    raise exception 'That invitation has expired. Ask for a new one.';
  end if;
  update public.organization_invites set answered_at = now(), accepted = p_accept where id = inv.id;
  if p_accept then
    insert into public.organization_memberships (organization_id, profile_id, role)
    values (inv.organization_id, inv.invited_profile_id, inv.role::public.org_member_role)
    on conflict (organization_id, profile_id) do nothing;
    if inv.group_id is not null and exists (select 1 from public.groups g where g.id = inv.group_id and g.organization_id = inv.organization_id and g.group_kind is distinct from 'one_on_one') then
      insert into public.group_memberships (group_id, profile_id, role)
      values (inv.group_id, inv.invited_profile_id, 'coach')
      on conflict do nothing;
    end if;
  end if;
  return inv.organization_id;
end;
$$;
revoke execute on function public.answer_organization_invite(uuid, boolean) from public, anon;
grant execute on function public.answer_organization_invite(uuid, boolean) to authenticated, service_role;

-- Leave an organization. The owner cannot (hand ownership over first), and a coach who is the only coach of a group that has clients cannot leave it behind.
create or replace function public.leave_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  g record;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.organization_memberships where organization_id = p_org and profile_id = me) then
    raise exception 'You are not part of that organization.';
  end if;
  if exists (select 1 from public.organizations where id = p_org and owner_id = me) then
    raise exception 'The owner cannot leave. Hand the organization over first.';
  end if;
  for g in
    select gm.group_id, gr.name
    from public.group_memberships gm
    join public.groups gr on gr.id = gm.group_id
    where gm.profile_id = me and gm.role = 'coach' and gr.organization_id = p_org
  loop
    if not exists (select 1 from public.group_memberships o where o.group_id = g.group_id and o.role = 'coach' and o.profile_id <> me)
       and exists (select 1 from public.group_memberships a where a.group_id = g.group_id and a.role = 'athlete') then
      raise exception 'You are the only coach of %. Add another coach or move its clients first.', g.name;
    end if;
  end loop;
  delete from public.group_memberships gm using public.groups gr
    where gm.group_id = gr.id and gr.organization_id = p_org and gm.profile_id = me and gm.role = 'coach';
  delete from public.organization_memberships where organization_id = p_org and profile_id = me;
end;
$$;
revoke execute on function public.leave_organization(uuid) from public, anon;
grant execute on function public.leave_organization(uuid) to authenticated, service_role;

-- For the server only: which existing account has this email address (so an invitation can be addressed to it). Never callable by a signed-in person.
create or replace function public.profile_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1
$$;
revoke execute on function public.profile_id_for_email(text) from public, anon, authenticated;
grant execute on function public.profile_id_for_email(text) to service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 98 (0352)' as step, '0352 Joining an organization needs the person''s OK: an owner can no longer put an existing account into their organization' as what, not ((to_regclass('public.organization_invites') is null)) as in_place
) as result order by step;
