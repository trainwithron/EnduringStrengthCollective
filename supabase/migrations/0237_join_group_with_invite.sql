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
