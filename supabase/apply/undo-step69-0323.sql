-- UNDO for step 69 (0323). Only if step 69 misbehaves. Cancels and removes any group events (and the feed posts that point at them), puts the class functions back exactly as they were, and drops the event functions and columns. Classes and balances are not touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
update public.group_sessions set status = 'cancelled', cancelled_at = now() where kind = 'event' and status = 'scheduled';
update public.bookings set status = 'cancelled' where id in (select anchor_booking_id from public.group_sessions where kind = 'event' and anchor_booking_id is not null) and status = 'confirmed';
delete from public.group_sessions where kind = 'event';
drop function if exists public.create_group_event(uuid, text, timestamptz, timestamptz, text, text, int);
drop function if exists public.join_group_event(uuid, uuid);
drop function if exists public.leave_group_event(uuid, uuid);
drop function if exists public.cancel_group_event(uuid);
drop function if exists public.mark_group_event_attendee(uuid, uuid, boolean);
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
drop policy if exists "group_session_attendees_select_event_staff" on public.group_session_attendees;
drop policy if exists "group_sessions_select_event_member" on public.group_sessions;
drop policy if exists "group_sessions_select_client" on public.group_sessions;
create policy "group_sessions_select_client" on public.group_sessions for select to authenticated using (public.is_client_of_coach(coach_id));
drop index if exists public.posts_group_session_idx;
alter table public.posts drop column if exists group_session_id;
drop index if exists public.group_sessions_group_start_idx;
alter table public.group_sessions drop constraint if exists group_sessions_kind_shape;
alter table public.group_sessions drop constraint if exists group_sessions_note_length;
alter table public.group_sessions drop constraint if exists group_sessions_kind_check;
alter table public.group_sessions alter column capacity set not null;
alter table public.group_sessions drop column if exists note;
alter table public.group_sessions drop column if exists group_id;
alter table public.group_sessions drop column if exists kind;
commit;
