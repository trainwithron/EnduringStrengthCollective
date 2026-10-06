-- Fixes to the small-group session rules (0263) found in review.
--
--   * Moving someone off the waiting list charges them (no floor: a client with no sessions left becomes "owed", as the 0263 header says) unless the
--     coach added them (the coach's own adds are charged when marked attended). It used to charge only when the balance was above zero.
--   * Nobody is moved off the waiting list into a class that has already started.
--   * A client who has sessions in a SECOND group with the same coach is no longer told "no session credits" because the oldest group is empty: the
--     group with sessions is used first.
--   * The hidden anchor booking that holds the class's time can no longer be cancelled or moved through the ordinary booking functions or a direct
--     update while the class is scheduled; change or cancel the class instead.
--   * Creating a class takes a per-coach lock, and any new booking is refused if it overlaps a scheduled class (and a new class if it overlaps any
--     booking), checked inside the database at insert time, so two people acting at the same instant cannot both get the slot.
--   * A class's session type must belong to the coach who creates it.
-- Requires 0263. Re-runnable (replaces functions and the trigger).

-- ---- the lock-and-check on bookings ----------------------------------------------------------------------------------------------
create or replace function public.guard_group_session_bookings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op boolean := coalesce(current_setting('app.group_session_op', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'confirmed' then
      return new;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('coach-calendar:' || new.coach_id::text, 0));
    if v_op then
      -- The anchor of a new class: nothing else may overlap it.
      if exists (
        select 1 from public.bookings b
        where b.coach_id = new.coach_id and b.status = 'confirmed' and b.start_at < new.end_at and b.end_at > new.start_at
      ) or exists (
        select 1 from public.discovery_bookings d
        where d.coach_id = new.coach_id and d.status = 'confirmed' and d.start_at < new.end_at and d.end_at > new.start_at
      ) then
        raise exception 'that time is already taken';
      end if;
    elsif exists (
      select 1 from public.group_sessions gs
      join public.bookings b on b.id = gs.anchor_booking_id
      where gs.coach_id = new.coach_id and gs.status = 'scheduled' and b.status = 'confirmed'
        and b.start_at < new.end_at and b.end_at > new.start_at
    ) then
      raise exception 'that time is already taken';
    end if;
    return new;
  end if;

  -- UPDATE: the anchor of a scheduled class is not an ordinary booking.
  if not v_op
     and (new.status is distinct from old.status or new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at)
     and exists (select 1 from public.group_sessions gs where gs.anchor_booking_id = old.id and gs.status = 'scheduled') then
    raise exception 'This time is held by a group session. Change or cancel the group session instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_guard_group_sessions on public.bookings;
create trigger bookings_guard_group_sessions
  before insert or update on public.bookings
  for each row execute function public.guard_group_session_bookings();

-- ---- create: lock, session type ownership, anchor marked as such --------------------------------------------------------------------
create or replace function public.create_group_session(
  p_group_id uuid,
  p_title text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_capacity int,
  p_session_type_id uuid default null,
  p_location_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach uuid := auth.uid();
  v_anchor uuid;
  v_id uuid;
begin
  if v_coach is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to schedule a group session';
  end if;
  if p_end_at <= p_start_at or p_start_at <= now() then
    raise exception 'pick a time in the future';
  end if;
  if p_capacity is null or p_capacity < 1 or p_capacity > 50 then
    raise exception 'capacity must be between 1 and 50';
  end if;
  if p_session_type_id is not null and not exists (select 1 from public.session_types st where st.id = p_session_type_id and st.coach_id = v_coach) then
    raise exception 'that session type is not yours';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('coach-calendar:' || v_coach::text, 0));

  if exists (
    select 1 from public.bookings b
    where b.coach_id = v_coach and b.status = 'confirmed' and b.start_at < p_end_at and b.end_at > p_start_at
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = v_coach and d.status = 'confirmed' and d.start_at < p_end_at and d.end_at > p_start_at
  ) then
    raise exception 'that time is already taken';
  end if;

  -- The hidden booking that keeps this time blocked everywhere. Waived, so nothing ever charges or settles against it, and
  -- already "reminded", so the reminder job leaves it alone. The flag tells the bookings trigger this insert is an anchor.
  perform set_config('app.group_session_op', '1', true);
  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state, reminder_sent_at)
  values (v_coach, v_coach, p_group_id, p_start_at, p_end_at, 'confirmed', 'waived', now())
  returning id into v_anchor;
  perform set_config('app.group_session_op', '0', true);

  insert into public.group_sessions (coach_id, title, session_type_id, start_at, end_at, capacity, location_note, anchor_booking_id)
  values (v_coach, btrim(p_title), p_session_type_id, p_start_at, p_end_at, p_capacity, nullif(btrim(coalesce(p_location_note, '')), ''), v_anchor)
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.create_group_session(uuid, text, timestamptz, timestamptz, int, uuid, text) to authenticated;

-- ---- waiting list --------------------------------------------------------------------------------------------------------------------
create or replace function public.promote_group_waitlist(p_session_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_next record;
  v_taken boolean;
  v_promoted uuid[] := '{}';
begin
  select * into s from public.group_sessions where id = p_session_id;
  if s.id is null or s.status <> 'scheduled' or s.start_at <= now() then
    return v_promoted;
  end if;

  loop
    exit when (
      select count(*) from public.group_session_attendees a
      where a.group_session_id = p_session_id and a.status in ('joined', 'attended')
    ) >= s.capacity;

    select * into v_next from public.group_session_attendees a
    where a.group_session_id = p_session_id and a.status = 'waitlisted'
    order by a.created_at asc
    limit 1
    for update;
    exit when v_next.id is null;

    -- Someone who joined the list on their own takes a session now, with no floor (no sessions left means owed). A person the coach
    -- added is charged when marked attended, as everywhere else.
    v_taken := not v_next.added_by_coach;
    if v_taken then
      perform public.apply_session_credit_change(v_next.athlete_id, v_next.group_id, -1, 'booked', 'Moved into ' || s.title, null, null);
    end if;

    update public.group_session_attendees
      set status = 'joined', credit_taken = v_taken, updated_at = now()
      where id = v_next.id;
    v_promoted := v_promoted || v_next.athlete_id;
  end loop;

  return v_promoted;
end;
$$;
revoke all on function public.promote_group_waitlist(uuid) from public, anon, authenticated;

-- ---- join: prefer the group that has sessions ---------------------------------------------------------------------------------------
create or replace function public.join_group_session(p_session_id uuid, p_athlete_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_self boolean;
  s record;
  v_group uuid;
  v_existing record;
  v_joined int;
  v_balance int;
  v_status text;
  v_taken boolean := false;
begin
  if v_caller is null then
    raise exception 'not authorized';
  end if;
  v_self := v_caller = p_athlete_id;

  -- Lock the class so counting spots and taking one is a single step.
  select * into s from public.group_sessions where id = p_session_id for update;
  if s.id is null then raise exception 'class not found'; end if;
  if s.status <> 'scheduled' then raise exception 'this class was cancelled'; end if;
  if s.start_at <= now() then raise exception 'this class has already started'; end if;

  -- The client's group with this coach (credits are kept per group): the one that has sessions left if there is one, else the oldest.
  select gm.group_id into v_group
  from public.group_memberships gm
  join public.group_memberships cm on cm.group_id = gm.group_id and cm.profile_id = s.coach_id and cm.role = 'coach'
  left join public.session_credits sc on sc.athlete_id = gm.profile_id and sc.group_id = gm.group_id
  where gm.profile_id = p_athlete_id and gm.role = 'athlete' and gm.membership_type = 'training'
  order by (coalesce(sc.balance, 0) > 0) desc, gm.joined_at asc
  limit 1;
  if v_group is null then raise exception 'not a training client of this coach'; end if;

  if not v_self and not public.is_group_coach(v_group) then
    raise exception 'not authorized to add this person';
  end if;

  select * into v_existing from public.group_session_attendees where group_session_id = p_session_id and athlete_id = p_athlete_id for update;
  if v_existing.id is not null and v_existing.status in ('joined', 'waitlisted', 'attended') then
    raise exception 'already in this class';
  end if;

  select count(*) into v_joined from public.group_session_attendees
    where group_session_id = p_session_id and status in ('joined', 'attended');

  if v_joined < s.capacity then
    v_status := 'joined';
    if v_self then
      select balance into v_balance from public.session_credits where athlete_id = p_athlete_id and group_id = v_group for update;
      if coalesce(v_balance, 0) <= 0 then
        raise exception 'no session credits remaining';
      end if;
      perform public.apply_session_credit_change(p_athlete_id, v_group, -1, 'booked', 'Joined ' || s.title, null, v_caller);
      v_taken := true;
    end if;
  else
    v_status := 'waitlisted';
  end if;

  if v_existing.id is not null then
    update public.group_session_attendees
      set status = v_status, credit_taken = v_taken, added_by_coach = not v_self, attended_at = null, group_id = v_group,
          created_at = now(), updated_at = now()
      where id = v_existing.id;
  else
    insert into public.group_session_attendees (group_session_id, athlete_id, group_id, status, credit_taken, added_by_coach)
    values (p_session_id, p_athlete_id, v_group, v_status, v_taken, not v_self);
  end if;

  return v_status;
end;
$$;
grant execute on function public.join_group_session(uuid, uuid) to authenticated;
