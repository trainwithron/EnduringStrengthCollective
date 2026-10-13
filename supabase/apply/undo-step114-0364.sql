-- UNDO for step 114 (0364). Only if step 114 misbehaves. Puts the four class functions and the client rule back as they were and removes the organization column (safe while no class exists; a class made after this step would lose its organization).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "group_sessions_select_client" on public.group_sessions;
create policy "group_sessions_select_client" on public.group_sessions for select to authenticated
  using (kind = 'class' and public.is_client_of_coach(coach_id));
create or replace function public.group_session_counts(p_session_ids uuid[])
returns table(session_id uuid, joined integer, waitlisted integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id,
         count(*) filter (where a.status in ('joined', 'attended'))::int,
         count(*) filter (where a.status = 'waitlisted')::int
  from public.group_sessions s
  left join public.group_session_attendees a on a.group_session_id = s.id
  where s.id = any(p_session_ids)
    and (s.coach_id = auth.uid() or public.is_client_of_coach(s.coach_id))
  group by s.id;
$function$;
create or replace function public.create_group_session(p_group_id uuid, p_title text, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_capacity integer, p_session_type_id uuid default null::uuid, p_location_note text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;
create or replace function public.join_group_session(p_session_id uuid, p_athlete_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;
drop function if exists public.is_client_of_coach_in_org(uuid, uuid);
alter table public.group_sessions drop column if exists organization_id;
commit;
