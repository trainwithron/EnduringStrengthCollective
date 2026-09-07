-- ============================================================================
-- GROUP_INVITES — shareable, expiring links a coach generates to bring
-- athletes into a group without a service-role admin API.
-- ============================================================================
create table public.group_invites (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  code text not null unique,
  role member_role not null default 'athlete',
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_group_invites_group on public.group_invites(group_id);

alter table public.group_invites enable row level security;

-- Members can see invites for their own group (e.g. a coach reviewing what's
-- outstanding). This does NOT cover the public invite landing page — an
-- unauthenticated visitor can't be a member yet, so that page uses the
-- get_invite_info() function below instead of querying this table directly.
create policy "group_invites_select_members"
  on public.group_invites for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "group_invites_insert_coach"
  on public.group_invites for insert
  to authenticated
  with check (public.is_group_coach(group_id) and created_by = auth.uid());

create policy "group_invites_delete_coach"
  on public.group_invites for delete
  to authenticated
  using (public.is_group_coach(group_id));

-- ----------------------------------------------------------------------------
-- Public, minimal invite lookup — callable by anon so a not-yet-registered
-- visitor can see "You're invited to <group>" before creating an account.
-- SECURITY DEFINER bypasses RLS deliberately; it only ever returns the group
-- name and invite validity, never anything else from `groups`.
-- ----------------------------------------------------------------------------
create or replace function public.get_invite_info(_code text)
returns table (
  group_id uuid,
  group_name text,
  role member_role,
  valid boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    gi.group_id,
    g.name as group_name,
    gi.role,
    (gi.expires_at is null or gi.expires_at > now()) as valid
  from public.group_invites gi
  join public.groups g on g.id = gi.group_id
  where gi.code = _code;
$$;

grant execute on function public.get_invite_info(text) to anon, authenticated;

-- ============================================================================
-- SECURITY FIX: the original self-join policy let any authenticated user
-- insert themselves into ANY group with ANY role — including 'coach'. That
-- was unused until now; the invite flow is the first thing to actually
-- exercise self-insert, so lock it down: self-join only ever grants 'athlete'.
-- Coaches are still added by an existing coach (is_group_coach check).
-- ============================================================================
drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self"
  on public.group_memberships for insert
  to authenticated
  with check (
    public.is_group_coach(group_id)
    or (profile_id = auth.uid() and role = 'athlete')
  );
