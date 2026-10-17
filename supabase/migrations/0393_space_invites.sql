-- 0393: a coach can invite someone who ALREADY has an account to be their one-on-one client. Until now the answer was "that email already has an account, use an invite link", and a one-on-one space has no invite
-- link, so a second coach could not add a person who already trains with someone else. The invitation is made by the server (it looks the email up), the person sees it as a notification and a page, and joins
-- the coach's one-on-one space only if they accept. Nothing is joined without their answer. Re-runnable.
-- Notification types. 'organization_invite' has been written by the invite-a-coach route since Release BD but was never in the list the database accepts, so an existing account invited to an organization got NO
-- notification at all (the insert was refused and the refusal ignored). It is added here with 'space_invite' and 'org_announcement', to the list the database already has.
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['organization_invite', 'space_invite', 'org_announcement']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

create table if not exists public.space_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  answered_at timestamptz,
  accepted boolean
);
create index if not exists space_invites_invited_idx on public.space_invites (invited_profile_id) where answered_at is null;
create unique index if not exists space_invites_one_open on public.space_invites (group_id, invited_profile_id) where answered_at is null;
alter table public.space_invites enable row level security;
revoke all on public.space_invites from anon;

-- The invited person sees their own invitations; a coach of the space sees who they invited. Making an invitation is the server's job; answering goes through the function below.
drop policy if exists "space_invites_select" on public.space_invites;
create policy "space_invites_select" on public.space_invites for select to authenticated
  using (invited_profile_id = (select auth.uid()) or public.is_group_coach(group_id));

-- Accept or decline. Accepting puts the person in the space as its client, if the space is still a one-on-one space with no client yet. Nobody else can answer for the person.
create or replace function public.answer_space_invite(p_invite uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.space_invites%rowtype;
begin
  select * into inv from public.space_invites where id = p_invite for update;
  if not found or auth.uid() is null or inv.invited_profile_id is distinct from auth.uid() then
    raise exception 'That invitation was not found.';
  end if;
  if inv.answered_at is not null then
    raise exception 'That invitation has already been answered.';
  end if;
  if inv.expires_at < now() then
    raise exception 'That invitation has expired. Ask your coach for a new one.';
  end if;
  if p_accept then
    if not public.is_one_on_one_group(inv.group_id) then
      raise exception 'That space is no longer a one-on-one space.';
    end if;
    if exists (select 1 from public.group_memberships where group_id = inv.group_id and role = 'athlete' and profile_id <> inv.invited_profile_id) then
      raise exception 'That space already has a client. Ask your coach to set up a new one.';
    end if;
    if exists (select 1 from public.group_memberships where group_id = inv.group_id and profile_id = inv.invited_profile_id and role = 'coach') then
      raise exception 'You coach that space yourself.';
    end if;
    insert into public.group_memberships (group_id, profile_id, role) values (inv.group_id, inv.invited_profile_id, 'athlete') on conflict do nothing;
  end if;
  update public.space_invites set answered_at = now(), accepted = p_accept where id = inv.id;
  return inv.group_id;
end;
$$;
revoke execute on function public.answer_space_invite(uuid, boolean) from public, anon;
grant execute on function public.answer_space_invite(uuid, boolean) to authenticated, service_role;

-- The coach withdraws an invitation that has not been answered.
create or replace function public.cancel_space_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.space_invites%rowtype;
begin
  select * into inv from public.space_invites where id = p_invite for update;
  if not found or auth.uid() is null or not public.is_group_coach(inv.group_id) then
    raise exception 'That invitation was not found.';
  end if;
  if inv.answered_at is not null then
    raise exception 'That invitation has already been answered.';
  end if;
  update public.space_invites set answered_at = now(), accepted = false where id = p_invite;
end;
$$;
revoke execute on function public.cancel_space_invite(uuid) from public, anon;
grant execute on function public.cancel_space_invite(uuid) to authenticated, service_role;
