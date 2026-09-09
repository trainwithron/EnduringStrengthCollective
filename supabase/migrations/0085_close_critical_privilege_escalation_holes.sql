-- Four confirmed, currently-exploitable holes found and independently
-- verified live (rolled-back transactions reproducing each exploit, then
-- re-run against the fix to confirm it closes the hole without breaking
-- the legitimate flow) during an overnight audit. All four let any
-- signed-up (or, for the last one, fully anonymous) user escalate
-- privilege or access data/resources they shouldn't, using nothing but
-- the public anon key already shipped in the browser bundle.

-- 1. profiles_update_own allowed any user to set their OWN
-- is_platform_admin to true (RLS is row-scoped, not column-scoped — the
-- policy correctly restricted WHICH ROW you could touch, but nothing
-- stopped you from changing any COLUMN on that row, including this one).
-- A trigger is the standard way to protect one column while leaving the
-- rest of the row self-editable: silently reverts the column instead of
-- rejecting the whole update, so a legitimate self-edit (e.g. full_name)
-- bundled in the same request still goes through. Only a service-role
-- caller (auth.role() = 'service_role' — no end-user session ever has
-- this) may actually change it.
create or replace function public.prevent_platform_admin_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin then
    if auth.role() <> 'service_role' then
      new.is_platform_admin := old.is_platform_admin;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_privilege_escalation on public.profiles;
create trigger profiles_prevent_privilege_escalation
  before update on public.profiles
  for each row execute function public.prevent_platform_admin_self_escalation();

-- 2. group_memberships' self-join branch let any authenticated user
-- insert themselves as an athlete into ANY group by guessing/knowing its
-- UUID (visible in every /groups/[groupId]/... URL) — the invite
-- link/code flow was only ever checked client-side, never at the DB
-- layer. Tightened to require an actually-still-valid group_invites row
-- for that group.
--
-- Needs a SECURITY DEFINER helper, not an inline subquery: group_invites
-- itself is only SELECT-able by existing group members
-- (group_invites_select_members: is_group_member(group_id)) — a
-- brand-new person joining via invite is by definition not yet a member,
-- so a plain correlated subquery inside this policy would see zero rows
-- and reject every legitimate join too. Same is_group_member/
-- is_org_admin_of_group-style bootstrapping problem already solved
-- elsewhere in this schema.
--
-- Deliberately NOT also gated on groups.public_invite_code — traced that
-- column end-to-end and it's never consulted by get_invite_info (the
-- only function /invite/[code] calls), so it currently grants no real
-- access; it's also already non-null on the one real group in
-- production, which would make that branch a no-op escape hatch rather
-- than a real check. The "join my team" link printed on shared workout
-- images is consequently dead today (get_invite_info never checks
-- public_invite_code) — a separate bug, fix it by wiring that function
-- to also check the column, not by using it here.
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
      and gi.expires_at > now()
  );
$$;

drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self"
  on public.group_memberships for insert
  to authenticated
  with check (
    public.is_group_coach(group_id)
    or (
      profile_id = auth.uid()
      and role = 'athlete'
      and public.has_valid_group_invite(group_id)
    )
    or (profile_id = auth.uid() and role = 'coach' and public.is_org_admin_of_group(group_id))
  );

-- 3. session_credits' direct-table update policy let an athlete set
-- their own balance to any value (a real incident already happened here
-- once — see 0064 — which patched the adjust_session_credits RPC but
-- never actually removed this raw-table escape hatch). Every real
-- write path in the app (book-slot-button.tsx, cancel-booking-button.tsx,
-- coach's session-credits-control.tsx) already goes exclusively through
-- that RPC, which is SECURITY DEFINER and enforces the real rules (an
-- athlete may only ever decrease their own balance). Dropping this
-- policy removes a redundant, unsafe path with no legitimate caller —
-- confirmed live that adjust_session_credits still works fine afterward.
drop policy if exists "credits_athlete_update_own" on public.session_credits;

-- 4. groups_select_public_workout_share (anon) exposed the FULL groups
-- row — including public_invite_code, a permanent unauthenticated join
-- code — to any unauthenticated visitor for any group with a public
-- share card, with zero relation to what a share card actually needs
-- (just the group's name). Row-level policies can't restrict columns;
-- Postgres column-level privileges can. Row-visibility is unchanged;
-- anon simply can no longer select the sensitive columns.
revoke select on public.groups from anon;
grant select (id, name) on public.groups to anon;
