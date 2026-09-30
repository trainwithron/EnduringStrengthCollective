-- group_kind_enforcement_investigation_sept29.md — the invite-link
-- reuse vector: get_invite_info only ever checked expiry, never whether
-- a one_on_one group already has its one athlete. A confirmed-real
-- production violation happened exactly this way: the same invite code
-- was used by two separate people to join a group tagged one_on_one.
--
-- Folded into the existing `valid` boolean rather than adding a new
-- field — app/invite/[code]/page.tsx already renders a single, generic
-- "invalid or expired" message for `!valid`, and "ask your coach for a
-- new one" is the correct real-world action here too, so no new UI
-- branch is needed. Security definer (unchanged) so this can see the
-- group's member count even though the invitee isn't a member yet —
-- the one legitimate reason this function bypasses RLS at all.
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
      (gi.expires_at is null or gi.expires_at > now())
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
