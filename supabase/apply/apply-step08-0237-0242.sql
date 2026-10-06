-- STEP 08: 0237 join a group with an invite code (checked in the database), 0242 cancelling invite links
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for a person joining yet (the old way still works until step 09). Then run supabase/ron-test-invite-join.md BEFORE step 09 (0238).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ====================================================================================================
-- migration 0237_join_group_with_invite.sql
-- ====================================================================================================

-- Joining a group by invite link, bound to the actual invite code.
--
-- Until now the self-join policy on group_memberships only asked "does this
-- group have ANY unexpired invite?" (has_valid_group_invite(group_id)), not
-- "did this person present a valid code?". Anyone signed in who learned a
-- group's id could insert themselves as an athlete into any group that had a
-- live invite. This function is the code-bound path: it checks the code, its
-- expiry and the one-on-one limit, then adds the caller as an athlete.
--
-- This migration is additive and safe to apply before the app deploys: the old
-- direct-insert path keeps working until 0238 (applied AFTER the deploy)
-- removes the loose policy branch.
create or replace function public.join_group_with_invite(_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_kind text;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  select gi.group_id, gi.role, gi.expires_at
    into v_invite
  from public.group_invites gi
  where gi.code = _code;

  if not found then
    raise exception 'invite_invalid';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite_expired';
  end if;
  -- Self-join only ever grants athlete, whatever the invite row says.
  if v_invite.role <> 'athlete' then
    raise exception 'invite_invalid';
  end if;

  -- Already a member: nothing to do, just hand back the group.
  if exists (
    select 1 from public.group_memberships
    where group_id = v_invite.group_id and profile_id = v_uid
  ) then
    return v_invite.group_id;
  end if;

  select group_kind into v_kind from public.groups where id = v_invite.group_id;
  if v_kind = 'one_on_one' and exists (
    select 1 from public.group_memberships
    where group_id = v_invite.group_id and role = 'athlete'
  ) then
    raise exception 'invite_used';
  end if;

  begin
    insert into public.group_memberships (group_id, profile_id, role)
    values (v_invite.group_id, v_uid, 'athlete');
  exception when others then
    -- Two people racing for the same one-on-one link: the loser trips the
    -- one-on-one trigger. Say so plainly instead of leaking trigger text.
    if sqlerrm like '%already has a client%' then
      raise exception 'invite_used';
    end if;
    raise;
  end;

  return v_invite.group_id;
end;
$$;

revoke execute on function public.join_group_with_invite(text) from public, anon;
grant execute on function public.join_group_with_invite(text) to authenticated;

-- ====================================================================================================
-- migration 0242_invite_revocation.sql
-- ====================================================================================================

-- Invite management: coaches can cancel (revoke) invite links and see which
-- are live, used, expired or cancelled.
--
-- Run AFTER 0237 (join_group_with_invite), which this re-creates with a
-- revoked check. The app works without this migration: until it is applied,
-- cancelling a group link deletes it outright and claim links keep using
-- used_at only.

alter table public.group_invites
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles(id);

alter table public.client_invites
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles(id);

-- A cancelled link must stop working everywhere a link is checked.

-- 1. The landing page lookup (adds "not revoked" to the existing validity rule
--    from 0215, including the one-on-one "already has a client" check).
create or replace function public.get_invite_info(_code text)
returns table(group_id uuid, group_name text, role member_role, valid boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    gi.group_id,
    g.name as group_name,
    gi.role,
    (
      gi.revoked_at is null
      and (gi.expires_at is null or gi.expires_at > now())
      and not (
        gi.role = 'athlete'
        and g.group_kind = 'one_on_one'
        and exists (
          select 1 from public.group_memberships gm
          where gm.group_id = gi.group_id and gm.role = 'athlete'
        )
      )
    ) as valid
  from public.group_invites gi
  join public.groups g on g.id = gi.group_id
  where gi.code = _code;
$$;

-- 2. The old loose self-join policy (until 0238 removes it) counted any
--    unexpired invite; a cancelled one must not count.
create or replace function public.has_valid_group_invite(target_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_invites gi
    where gi.group_id = target_group_id
      and gi.revoked_at is null
      and gi.expires_at > now()
  );
$$;

-- 3. The code-bound join (from 0237) with the same revoked check.
create or replace function public.join_group_with_invite(_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_kind text;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  select gi.group_id, gi.role, gi.expires_at, gi.revoked_at
    into v_invite
  from public.group_invites gi
  where gi.code = _code;

  if not found then
    raise exception 'invite_invalid';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite_invalid';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite_expired';
  end if;
  if v_invite.role <> 'athlete' then
    raise exception 'invite_invalid';
  end if;

  if exists (
    select 1 from public.group_memberships
    where group_id = v_invite.group_id and profile_id = v_uid
  ) then
    return v_invite.group_id;
  end if;

  select group_kind into v_kind from public.groups where id = v_invite.group_id;
  if v_kind = 'one_on_one' and exists (
    select 1 from public.group_memberships
    where group_id = v_invite.group_id and role = 'athlete'
  ) then
    raise exception 'invite_used';
  end if;

  begin
    insert into public.group_memberships (group_id, profile_id, role)
    values (v_invite.group_id, v_uid, 'athlete');
  exception when others then
    if sqlerrm like '%already has a client%' then
      raise exception 'invite_used';
    end if;
    raise;
  end;

  return v_invite.group_id;
end;
$$;

revoke execute on function public.join_group_with_invite(text) from public, anon;
grant execute on function public.join_group_with_invite(text) to authenticated;

commit;
