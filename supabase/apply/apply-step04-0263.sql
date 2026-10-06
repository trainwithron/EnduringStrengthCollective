-- STEP 04: 0263 small-group sessions with spots, waiting list and charges
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Coaches get Group Sessions (schedule a class with spots); clients get a Classes page and one-tap Join.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.group_sessions') is null)) then
    raise exception 'Step 04 (0263) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0263_group_sessions.sql
-- ====================================================================================================

-- Small-group sessions with a capacity: a coach runs "Tuesday 6 PM small group, 6 spots" and clients just tap to join.
--
--   * group_sessions: one scheduled class (title, time, capacity, place note, optional session type).
--   * group_session_attendees: who is in it. Status joined / waitlisted / cancelled / attended.
--   * While a class is scheduled it holds a hidden "anchor" booking in the coach's own calendar, so every existing check
--     (a client booking one-on-one, the public booking page, weekly schedules, the discovery calls) already sees the coach as
--     busy at that time without any of them changing. The anchor is waived (never charged) and never reminded.
--   * Credits: a client who joins on their own takes one session at once (they need one). A coach who adds someone takes nothing
--     until the class happens (then marking attended charges, with no floor, like any coach-delivered session). A full class puts
--     the next person on a waiting list; whoever is first on it moves in when a spot opens, and is charged then.
--     Leaving: a client who leaves inside the coach's cancellation window forfeits the session; a coach removing someone, or
--     cancelling the class, always refunds what was taken.
-- Capacity is enforced inside the database (the class row is locked while spots are counted), so two people tapping at the same
-- instant can never both get the last spot. Nothing writes these tables directly: every change goes through the functions below.
-- Requires 0246 and 0248 (ledger, credit_state) and 0180 (session types).

create table public.group_sessions (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  session_type_id uuid references public.session_types(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  capacity int not null check (capacity between 1 and 50),
  location_note text check (location_note is null or char_length(location_note) <= 200),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  anchor_booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index group_sessions_coach_start_idx on public.group_sessions (coach_id, start_at);

create table public.group_session_attendees (
  id uuid primary key default uuid_generate_v4(),
  group_session_id uuid not null references public.group_sessions(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  status text not null check (status in ('joined', 'waitlisted', 'cancelled', 'attended')),
  credit_taken boolean not null default false,
  added_by_coach boolean not null default false,
  attended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_session_id, athlete_id)
);
create index group_session_attendees_session_idx on public.group_session_attendees (group_session_id, status, created_at);
create index group_session_attendees_athlete_idx on public.group_session_attendees (athlete_id);

alter table public.group_sessions enable row level security;
alter table public.group_session_attendees enable row level security;

-- Read only. The coach sees their own classes; their clients see them too (to join). A client sees only their own attendance
-- row, never who else is in the class (use group_session_counts for how many).
create policy "group_sessions_select_coach" on public.group_sessions for select
  to authenticated using (coach_id = (select auth.uid()));
create policy "group_sessions_select_client" on public.group_sessions for select
  to authenticated using (public.is_client_of_coach(coach_id));

create policy "group_session_attendees_select_own" on public.group_session_attendees for select
  to authenticated using (athlete_id = (select auth.uid()));
create policy "group_session_attendees_select_coach" on public.group_session_attendees for select
  to authenticated using (
    exists (select 1 from public.group_sessions s where s.id = group_session_id and s.coach_id = (select auth.uid()))
  );

-- ---- how many are in each class ------------------------------------------------------------------------------------------
create or replace function public.group_session_counts(p_session_ids uuid[])
returns table(session_id uuid, joined int, waitlisted int)
language sql
security definer
stable
set search_path = public
as $$
  select s.id,
         count(*) filter (where a.status in ('joined', 'attended'))::int,
         count(*) filter (where a.status = 'waitlisted')::int
  from public.group_sessions s
  left join public.group_session_attendees a on a.group_session_id = s.id
  where s.id = any(p_session_ids)
    and (s.coach_id = auth.uid() or public.is_client_of_coach(s.coach_id))
  group by s.id;
$$;
grant execute on function public.group_session_counts(uuid[]) to authenticated;

-- ---- create ---------------------------------------------------------------------------------------------------------------
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
  -- already "reminded", so the reminder job leaves it alone.
  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state, reminder_sent_at)
  values (v_coach, v_coach, p_group_id, p_start_at, p_end_at, 'confirmed', 'waived', now())
  returning id into v_anchor;

  insert into public.group_sessions (coach_id, title, session_type_id, start_at, end_at, capacity, location_note, anchor_booking_id)
  values (v_coach, btrim(p_title), p_session_type_id, p_start_at, p_end_at, p_capacity, nullif(btrim(coalesce(p_location_note, '')), ''), v_anchor)
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.create_group_session(uuid, text, timestamptz, timestamptz, int, uuid, text) to authenticated;

-- ---- waiting list: move people in while there is room ------------------------------------------------------------------------
-- Internal. Charges each person moved in (no floor: a client with no sessions left becomes "owed", which the coach sees as
-- needing payment) and returns who was moved.
create or replace function public.promote_group_waitlist(p_session_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_next record;
  v_balance int;
  v_taken boolean;
  v_promoted uuid[] := '{}';
begin
  select * into s from public.group_sessions where id = p_session_id;
  if s.id is null or s.status <> 'scheduled' then
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

    select balance into v_balance from public.session_credits
      where athlete_id = v_next.athlete_id and group_id = v_next.group_id;
    v_taken := coalesce(v_balance, 0) > 0;
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

-- ---- join -----------------------------------------------------------------------------------------------------------------
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

  -- The client's own group with this coach (credits are kept per group).
  select gm.group_id into v_group
  from public.group_memberships gm
  join public.group_memberships cm on cm.group_id = gm.group_id and cm.profile_id = s.coach_id and cm.role = 'coach'
  where gm.profile_id = p_athlete_id and gm.role = 'athlete' and gm.membership_type = 'training'
  order by gm.joined_at asc
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

-- ---- leave ----------------------------------------------------------------------------------------------------------------
-- Returns the people moved in off the waiting list (so the app can tell them).
create or replace function public.leave_group_session(p_session_id uuid, p_athlete_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_self boolean;
  s record;
  a record;
  v_window int;
  v_refund boolean;
begin
  if v_caller is null then raise exception 'not authorized'; end if;
  v_self := v_caller = p_athlete_id;

  select * into s from public.group_sessions where id = p_session_id for update;
  if s.id is null then raise exception 'class not found'; end if;

  select * into a from public.group_session_attendees where group_session_id = p_session_id and athlete_id = p_athlete_id for update;
  if a.id is null or a.status not in ('joined', 'waitlisted') then
    raise exception 'not in this class';
  end if;
  if not v_self and not public.is_group_coach(a.group_id) then
    raise exception 'not authorized to remove this person';
  end if;

  if a.status = 'joined' and a.credit_taken then
    if v_self then
      select coalesce((select cancellation_window_hours from public.coach_booking_policies where coach_id = s.coach_id), 24) into v_window;
      v_refund := (s.start_at - now()) >= make_interval(hours => v_window);
    else
      v_refund := true;
    end if;
    if v_refund then
      perform public.apply_session_credit_change(a.athlete_id, a.group_id, 1, 'refund', 'Left ' || s.title, null, v_caller);
    end if;
  end if;

  update public.group_session_attendees
    set status = 'cancelled', credit_taken = false, updated_at = now()
    where id = a.id;

  if a.status = 'joined' then
    return public.promote_group_waitlist(p_session_id);
  end if;
  return '{}'::uuid[];
end;
$$;
grant execute on function public.leave_group_session(uuid, uuid) to authenticated;

-- ---- change the number of spots ---------------------------------------------------------------------------------------------
create or replace function public.set_group_session_capacity(p_session_id uuid, p_capacity int)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_joined int;
begin
  select * into s from public.group_sessions where id = p_session_id for update;
  if s.id is null then raise exception 'class not found'; end if;
  if auth.uid() is null or s.coach_id <> auth.uid() then raise exception 'not authorized'; end if;
  if p_capacity is null or p_capacity < 1 or p_capacity > 50 then raise exception 'capacity must be between 1 and 50'; end if;
  select count(*) into v_joined from public.group_session_attendees where group_session_id = p_session_id and status in ('joined', 'attended');
  if p_capacity < v_joined then
    raise exception 'there are already % people in this class. Remove someone first.', v_joined;
  end if;
  update public.group_sessions set capacity = p_capacity where id = p_session_id;
  return public.promote_group_waitlist(p_session_id);
end;
$$;
grant execute on function public.set_group_session_capacity(uuid, int) to authenticated;

-- ---- cancel the whole class ----------------------------------------------------------------------------------------------------
-- Everyone who was charged gets it back. Returns everyone who was in or waiting for the class (so the app can tell them).
create or replace function public.cancel_group_session(p_session_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  a record;
  v_all uuid[] := '{}';
begin
  select * into s from public.group_sessions where id = p_session_id for update;
  if s.id is null then raise exception 'class not found'; end if;
  if auth.uid() is null or s.coach_id <> auth.uid() then raise exception 'not authorized'; end if;
  if s.status = 'cancelled' then return v_all; end if;

  for a in
    select * from public.group_session_attendees
    where group_session_id = p_session_id and status in ('joined', 'waitlisted') for update
  loop
    if a.status = 'joined' and a.credit_taken then
      perform public.apply_session_credit_change(a.athlete_id, a.group_id, 1, 'refund', 'Cancelled: ' || s.title, null, auth.uid());
    end if;
    update public.group_session_attendees set status = 'cancelled', credit_taken = false, updated_at = now() where id = a.id;
    v_all := v_all || a.athlete_id;
  end loop;

  update public.group_sessions set status = 'cancelled', cancelled_at = now() where id = p_session_id;
  if s.anchor_booking_id is not null then
    update public.bookings set status = 'cancelled' where id = s.anchor_booking_id;
  end if;
  return v_all;
end;
$$;
grant execute on function public.cancel_group_session(uuid) to authenticated;

-- ---- attendance -----------------------------------------------------------------------------------------------------------
-- Coach only. Marking someone attended charges a session if none was taken yet (a person the coach added). No floor.
create or replace function public.mark_group_attendee(p_session_id uuid, p_athlete_id uuid, p_attended boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  a record;
begin
  select * into s from public.group_sessions where id = p_session_id for update;
  if s.id is null then raise exception 'class not found'; end if;
  if auth.uid() is null or s.coach_id <> auth.uid() then raise exception 'not authorized'; end if;

  select * into a from public.group_session_attendees where group_session_id = p_session_id and athlete_id = p_athlete_id for update;
  if a.id is null or a.status not in ('joined', 'attended') then raise exception 'not in this class'; end if;

  if p_attended then
    if a.status = 'attended' then return; end if;
    if not a.credit_taken then
      perform public.apply_session_credit_change(a.athlete_id, a.group_id, -1, 'delivered', 'Attended ' || s.title, null, auth.uid());
    end if;
    update public.group_session_attendees set status = 'attended', credit_taken = true, attended_at = now(), updated_at = now() where id = a.id;
  else
    if a.status <> 'attended' then return; end if;
    -- Undo the mark only. The session stays charged; remove the person or adjust the balance to give it back.
    update public.group_session_attendees set status = 'joined', attended_at = null, updated_at = now() where id = a.id;
  end if;
end;
$$;
grant execute on function public.mark_group_attendee(uuid, uuid, boolean) to authenticated;

commit;
