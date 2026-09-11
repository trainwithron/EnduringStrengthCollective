-- Real gap confirmed by a stress-test pass: group_memberships' unique
-- constraint is (group_id, profile_id), not profile_id alone, so a
-- client can genuinely belong to two of the same coach's groups (e.g. a
-- real 1-on-1 training group plus a second, access-only social/team
-- group). coach_packages visibility and the book_session() booking RPC
-- both gate on is_client_of_coach() — "is this person an athlete in ANY
-- group this coach coaches" — not on whether they're a genuine training
-- client of the SPECIFIC group a package or booking actually belongs to.
-- A client with that second membership would see both groups' packages
-- mixed together and could book a session attributed to a group they
-- were only ever given access-only membership to.
--
-- Fix: distinguish a genuine training relationship from an access-only
-- one on group_memberships itself, and scope package visibility +
-- booking eligibility to "training client of THIS group", not "client
-- of this coach anywhere". Every other is_client_of_coach() call site
-- (coach_availability_windows, pro_shop_links, referral_partners,
-- coach_availability_exceptions, challenges, athlete_profile_details,
-- prospect discovery) is deliberately left untouched — those are
-- legitimately coach-wide resources by design, not group-scoped ones,
-- and widening this fix to all of them would be a much bigger change
-- than the actual gap calls for.

alter table public.group_memberships
  add column membership_type text not null default 'training'
    check (membership_type in ('training', 'social_only'));

-- Every existing membership defaults to 'training' — this is additive
-- and changes nothing about who can already see packages or book
-- sessions today. 'social_only' has no creation flow yet (that's the
-- separate, not-yet-built "join a group for social access only"
-- feature) — this column exists so that when it does, package
-- visibility and booking eligibility are already correctly scoped.

create or replace function public.is_training_client_of_group(
  _group_id uuid,
  _athlete_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships
    where group_id = _group_id
      and profile_id = _athlete_id
      and role = 'athlete'
      and membership_type = 'training'
  );
$$;

-- Package visibility (live policy name post-consolidation is
-- coach_packages_select_own_or_client, 0110) — a package belongs to
-- exactly one group (coach_packages.group_id); eligibility should only
-- ever be "are you a real training client of THAT group", never "of
-- this coach anywhere". The coach's-own-view branch and the
-- is_package_assigned_to_viewer() private-assignment branch (0104) are
-- unchanged.
drop policy "coach_packages_select_own_or_client" on public.coach_packages;
create policy "coach_packages_select_own_or_client" on public.coach_packages for select
  to authenticated using (
    (coach_id = (select auth.uid()))
    or (is_active and public.is_training_client_of_group(group_id) and (is_public or is_package_assigned_to_viewer(id)))
  );

-- Direct-insert path on bookings is unused by the app today (every
-- booking goes through the atomic book_session() RPC below) but this
-- closes the same gap for anyone hitting the table directly. Live
-- policy name post-consolidation is bookings_insert_by_coach_or_own_client
-- (0079) — the coach-assigning-on-behalf-of-a-client branch is unchanged.
drop policy "bookings_insert_by_coach_or_own_client" on public.bookings;
create policy "bookings_insert_by_coach_or_own_client" on public.bookings for insert
  to authenticated with check (
    ((coach_id = (select auth.uid())) and is_group_coach(group_id))
    or ((athlete_id = (select auth.uid())) and public.is_training_client_of_group(group_id))
  );

-- The real, actually-used booking path: swap the coach-wide eligibility
-- check for a group-scoped one, checked against the booking's own
-- target athlete (p_athlete_id) — not necessarily the caller, since a
-- coach can book on a client's behalf. Everything else in this function
-- (credit check, overlap guard against real bookings and discovery
-- calls) is unchanged from its current live definition (0089).
create or replace function public.book_session(
  p_coach_id uuid,
  p_athlete_id uuid,
  p_group_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_self boolean;
  v_balance int;
  v_booking_id uuid;
begin
  v_is_self := auth.uid() = p_athlete_id;

  if not v_is_self and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to book this session';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid time range';
  end if;

  if v_is_self then
    select balance into v_balance from public.session_credits
      where athlete_id = p_athlete_id and group_id = p_group_id;
    if coalesce(v_balance, 0) <= 0 then
      raise exception 'no session credits remaining';
    end if;
  end if;

  if exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id
      and b.status = 'confirmed'
      and b.start_at < p_end_at
      and b.end_at > p_start_at
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = p_coach_id
      and d.status = 'confirmed'
      and d.start_at < p_end_at
      and d.end_at > p_start_at
  ) then
    raise exception 'that slot was just taken';
  end if;

  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status)
  values (p_coach_id, p_athlete_id, p_group_id, p_start_at, p_end_at, 'confirmed')
  returning id into v_booking_id;

  perform public.adjust_session_credits(p_athlete_id, p_group_id, -1);

  return v_booking_id;
end;
$$;

grant execute on function public.book_session(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
