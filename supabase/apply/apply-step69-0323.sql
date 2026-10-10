-- STEP 69: 0323 Group events: a coach can add an event for one group (a monthly gym workout then lunch); members answer In or Out; it costs no session credit on any path, and the class functions now refuse an event
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for classes or anyone's balance. The app can now create group events, post one announcement to the group's feed, and record In and Out answers. An event never takes, refunds or charges a session.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_sessions' and column_name = 'kind'))) then
    raise exception 'Step 69 (0323) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0323_group_events.sql
-- ====================================================================================================

-- Group events: "monthly gym workout, then lunch" for one group. Members answer In or Out; it costs no session credit, ever.
--
-- It reuses the group-session tables rather than building a second system: a group_sessions row with kind = 'event' (it belongs to one group, has an optional
-- number of spots, a place and a note) and the same attendee rows. An attendee's status is the answer: 'joined' = In, 'cancelled' = Out (a row is written even
-- for someone who says Out without ever saying In, so Out is never the same as no answer), no row = no answer yet, 'attended' = the coach marked them there,
-- 'waitlisted' = In, but full.
--
-- NO CREDIT IS EVER TOUCHED BY AN EVENT. The event has its own functions (create/join/leave/cancel/mark_group_event_*) that never call the credit functions
-- at all, and the five class functions that DO move credits (join, leave, cancel, mark attended, change spots) and the waiting-list mover now refuse an
-- event outright, so there is no path from an event to the ledger. Classes behave exactly as before (the only change to those functions is one early
-- refusal line when the row is an event; the rest of each body is the live text, unchanged).
--
-- The hidden "anchor" booking that holds a class's time is made for an event too, so the coach is shown as busy then and nothing can be booked over it.
-- Members of the event's group may read the event (any member type, a social group included). Requires 0263 and 0269.

alter table public.group_sessions add column if not exists kind text not null default 'class';
alter table public.group_sessions drop constraint if exists group_sessions_kind_check;
alter table public.group_sessions add constraint group_sessions_kind_check check (kind in ('class', 'event'));
alter table public.group_sessions add column if not exists group_id uuid references public.groups(id) on delete cascade;
alter table public.group_sessions add column if not exists note text;
alter table public.group_sessions drop constraint if exists group_sessions_note_length;
alter table public.group_sessions add constraint group_sessions_note_length check (note is null or char_length(note) <= 500);
-- An event may have no limit on spots.
alter table public.group_sessions alter column capacity drop not null;
alter table public.group_sessions drop constraint if exists group_sessions_kind_shape;
alter table public.group_sessions add constraint group_sessions_kind_shape check ((kind = 'class' and capacity is not null) or (kind = 'event' and group_id is not null));
create index if not exists group_sessions_group_start_idx on public.group_sessions (group_id, start_at) where group_id is not null;

-- The announcement in the group's feed points at its event (so In/Out buttons can sit on the post). Deleting the event removes the post.
alter table public.posts add column if not exists group_session_id uuid references public.group_sessions(id) on delete cascade;
create index if not exists posts_group_session_idx on public.posts (group_session_id) where group_session_id is not null;

-- Members of the group can read its events (the coach can already read their own rows). A coach's clients in OTHER groups used to be able to read every row of
-- the coach's (that is how classes reach them), so that policy now covers classes only; an event is for its own group.
drop policy if exists "group_sessions_select_client" on public.group_sessions;
create policy "group_sessions_select_client" on public.group_sessions for select
  to authenticated using (kind = 'class' and public.is_client_of_coach(coach_id));
drop policy if exists "group_sessions_select_event_member" on public.group_sessions;
create policy "group_sessions_select_event_member" on public.group_sessions for select
  to authenticated using (kind = 'event' and public.is_group_member(group_id));

-- ---- the class functions refuse an event ---------------------------------------------------------------------------------------------
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
  if s.kind = 'event' then raise exception 'this is a group event, not a class'; end if;
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
  if s.kind = 'event' then raise exception 'this is a group event, not a class'; end if;

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
  if s.id is null or s.status <> 'scheduled' or s.start_at <= now() or s.kind = 'event' then
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
  if s.kind = 'event' then raise exception 'this is a group event, not a class'; end if;
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
  if s.kind = 'event' then raise exception 'this is a group event, not a class'; end if;
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
  if s.kind = 'event' then raise exception 'this is a group event, not a class'; end if;
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

-- ---- the event's own functions: none of them touches a credit -------------------------------------------------------------------------
create or replace function public.create_group_event(
  p_group_id uuid,
  p_title text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_place text default null,
  p_note text default null,
  p_capacity int default null
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
    raise exception 'not authorized to schedule a group event';
  end if;
  if p_title is null or char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 80 then
    raise exception 'give the event a name of 80 characters or fewer';
  end if;
  if p_end_at <= p_start_at or p_start_at <= now() then
    raise exception 'pick a time in the future';
  end if;
  if p_capacity is not null and (p_capacity < 1 or p_capacity > 50) then
    raise exception 'spots must be between 1 and 50';
  end if;
  if char_length(coalesce(p_place, '')) > 200 or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'the place or note is too long';
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

  -- The same hidden booking a class makes: waived (nothing ever charges or settles against it) and already "reminded".
  perform set_config('app.group_session_op', '1', true);
  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state, reminder_sent_at)
  values (v_coach, v_coach, p_group_id, p_start_at, p_end_at, 'confirmed', 'waived', now())
  returning id into v_anchor;
  perform set_config('app.group_session_op', '0', true);

  insert into public.group_sessions (coach_id, title, start_at, end_at, capacity, location_note, note, anchor_booking_id, kind, group_id)
  values (v_coach, btrim(p_title), p_start_at, p_end_at, p_capacity, nullif(btrim(coalesce(p_place, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), v_anchor, 'event', p_group_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- In. A member answers for themselves, or the coach answers for them. Asking twice is harmless. A full event puts the next person on a waiting list.
create or replace function public.join_group_event(p_session_id uuid, p_athlete_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_self boolean;
  s record;
  v_existing record;
  v_count int;
  v_status text;
begin
  if v_caller is null then raise exception 'not authorized'; end if;
  v_self := v_caller = p_athlete_id;

  select * into s from public.group_sessions where id = p_session_id for update;
  if s.id is null or s.kind <> 'event' then raise exception 'event not found'; end if;
  if s.status <> 'scheduled' then raise exception 'this event was cancelled'; end if;
  if s.start_at <= now() then raise exception 'this event has already started'; end if;

  if not exists (select 1 from public.group_memberships gm where gm.group_id = s.group_id and gm.profile_id = p_athlete_id and gm.role = 'athlete') then
    raise exception 'not a member of this group';
  end if;
  if not v_self and not public.is_group_coach(s.group_id) then
    raise exception 'not authorized to answer for this person';
  end if;

  select * into v_existing from public.group_session_attendees where group_session_id = p_session_id and athlete_id = p_athlete_id for update;
  if v_existing.id is not null and v_existing.status in ('joined', 'waitlisted', 'attended') then
    return v_existing.status;
  end if;

  select count(*) into v_count from public.group_session_attendees where group_session_id = p_session_id and status in ('joined', 'attended');
  v_status := case when s.capacity is not null and v_count >= s.capacity then 'waitlisted' else 'joined' end;

  if v_existing.id is not null then
    update public.group_session_attendees
      set status = v_status, credit_taken = false, added_by_coach = not v_self, attended_at = null, group_id = s.group_id, created_at = now(), updated_at = now()
      where id = v_existing.id;
  else
    insert into public.group_session_attendees (group_session_id, athlete_id, group_id, status, credit_taken, added_by_coach)
    values (p_session_id, p_athlete_id, s.group_id, v_status, false, not v_self);
  end if;
  return v_status;
end;
$$;

-- Out. Written down even for someone who never said In, so Out is not the same as no answer. If an In spot opens, the next person waiting moves in.
create or replace function public.leave_group_event(p_session_id uuid, p_athlete_id uuid)
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
  v_next record;
  v_promoted uuid[] := '{}';
begin
  if v_caller is null then raise exception 'not authorized'; end if;
  v_self := v_caller = p_athlete_id;

  select * into s from public.group_sessions where id = p_session_id for update;
  if s.id is null or s.kind <> 'event' then raise exception 'event not found'; end if;
  if s.status <> 'scheduled' then raise exception 'this event was cancelled'; end if;
  if s.start_at <= now() then raise exception 'this event has already started'; end if;

  if not exists (select 1 from public.group_memberships gm where gm.group_id = s.group_id and gm.profile_id = p_athlete_id and gm.role = 'athlete') then
    raise exception 'not a member of this group';
  end if;
  if not v_self and not public.is_group_coach(s.group_id) then
    raise exception 'not authorized to answer for this person';
  end if;

  select * into a from public.group_session_attendees where group_session_id = p_session_id and athlete_id = p_athlete_id for update;
  if a.id is null then
    insert into public.group_session_attendees (group_session_id, athlete_id, group_id, status, credit_taken, added_by_coach)
    values (p_session_id, p_athlete_id, s.group_id, 'cancelled', false, not v_self);
    return v_promoted;
  end if;
  if a.status = 'attended' then raise exception 'already marked as there'; end if;

  update public.group_session_attendees
    set status = 'cancelled', credit_taken = false, added_by_coach = not v_self, updated_at = now()
    where id = a.id;

  if a.status = 'joined' and s.capacity is not null then
    loop
      exit when (select count(*) from public.group_session_attendees x where x.group_session_id = p_session_id and x.status in ('joined', 'attended')) >= s.capacity;
      select * into v_next from public.group_session_attendees x
        where x.group_session_id = p_session_id and x.status = 'waitlisted'
        order by x.created_at asc limit 1 for update;
      exit when v_next.id is null;
      update public.group_session_attendees set status = 'joined', credit_taken = false, updated_at = now() where id = v_next.id;
      v_promoted := v_promoted || v_next.athlete_id;
    end loop;
  end if;
  return v_promoted;
end;
$$;

-- Cancel the whole event. Returns everyone who was In or waiting (so the app can tell them). Nothing to refund: nothing was ever taken.
create or replace function public.cancel_group_event(p_session_id uuid)
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
  if s.id is null or s.kind <> 'event' then raise exception 'event not found'; end if;
  if auth.uid() is null or not public.is_group_coach(s.group_id) then raise exception 'not authorized'; end if;
  if s.status = 'cancelled' then return v_all; end if;

  for a in
    select * from public.group_session_attendees
    where group_session_id = p_session_id and status in ('joined', 'waitlisted') for update
  loop
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

-- The coach marks who was there (or undoes it). No credit moves.
create or replace function public.mark_group_event_attendee(p_session_id uuid, p_athlete_id uuid, p_attended boolean)
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
  if s.id is null or s.kind <> 'event' then raise exception 'event not found'; end if;
  if auth.uid() is null or not public.is_group_coach(s.group_id) then raise exception 'not authorized'; end if;

  select * into a from public.group_session_attendees where group_session_id = p_session_id and athlete_id = p_athlete_id for update;
  if a.id is null or a.status not in ('joined', 'attended') then raise exception 'not In for this event'; end if;

  if p_attended then
    update public.group_session_attendees set status = 'attended', attended_at = coalesce(attended_at, now()), updated_at = now() where id = a.id and status <> 'attended';
  else
    update public.group_session_attendees set status = 'joined', attended_at = null, updated_at = now() where id = a.id and status = 'attended';
  end if;
end;
$$;

revoke all on function public.create_group_event(uuid, text, timestamptz, timestamptz, text, text, int) from public, anon;
grant execute on function public.create_group_event(uuid, text, timestamptz, timestamptz, text, text, int) to authenticated;
revoke all on function public.join_group_event(uuid, uuid) from public, anon;
grant execute on function public.join_group_event(uuid, uuid) to authenticated;
revoke all on function public.leave_group_event(uuid, uuid) from public, anon;
grant execute on function public.leave_group_event(uuid, uuid) to authenticated;
revoke all on function public.cancel_group_event(uuid) from public, anon;
grant execute on function public.cancel_group_event(uuid) to authenticated;
revoke all on function public.mark_group_event_attendee(uuid, uuid, boolean) from public, anon;
grant execute on function public.mark_group_event_attendee(uuid, uuid, boolean) to authenticated;

-- ---- events are not credit-bearing, so the counts of booked and to-mark sessions leave them out -----------------------------------------
create or replace function public.booking_counts(
  p_coach_id uuid default null,
  p_athlete_id uuid default null,
  p_athlete_ids uuid[] default null,
  p_group_id uuid default null
)
returns table (athlete_id uuid, group_id uuid, booked int, to_mark int, prepaid_ahead int)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select u.athlete_id,
         u.group_id,
         sum(u.booked)::int as booked,
         sum(u.to_mark)::int as to_mark,
         sum(u.prepaid_ahead)::int as prepaid_ahead
  from (
    select b.athlete_id,
           b.group_id,
           (count(*) filter (where b.end_at >= now() and b.credit_state = 'unsettled'))::int as booked,
           (count(*) filter (where b.end_at < now() and b.credit_state = 'unsettled' and b.attended_at is null and not b.no_show))::int as to_mark,
           (count(*) filter (where b.end_at >= now() and b.credit_state = 'prepaid'))::int as prepaid_ahead
    from public.bookings b
    where b.status = 'confirmed'
      and b.credit_state in ('unsettled', 'prepaid')
      and (b.end_at >= now() or (b.credit_state = 'unsettled' and b.attended_at is null and not b.no_show))
      and (p_coach_id is null or b.coach_id = p_coach_id)
      and (p_athlete_id is null or b.athlete_id = p_athlete_id)
      and (p_athlete_ids is null or b.athlete_id = any (p_athlete_ids))
      and (p_group_id is null or b.group_id = p_group_id)
    group by b.athlete_id, b.group_id
    union all
    select a.athlete_id,
           a.group_id,
           (count(*) filter (where s.end_at >= now() and not a.credit_taken))::int as booked,
           (count(*) filter (where s.end_at < now() and not a.credit_taken))::int as to_mark,
           (count(*) filter (where s.end_at >= now() and a.credit_taken))::int as prepaid_ahead
    from public.group_session_attendees a
    join public.group_sessions s on s.id = a.group_session_id
    where a.status = 'joined'
      and s.status = 'scheduled'
      and s.kind = 'class'
      and (s.end_at >= now() or not a.credit_taken)
      and (p_coach_id is null or s.coach_id = p_coach_id)
      and (p_athlete_id is null or a.athlete_id = p_athlete_id)
      and (p_athlete_ids is null or a.athlete_id = any (p_athlete_ids))
      and (p_group_id is null or a.group_id = p_group_id)
    group by a.athlete_id, a.group_id
  ) u
  group by u.athlete_id, u.group_id
  order by u.athlete_id, u.group_id;
$function$;

commit;
