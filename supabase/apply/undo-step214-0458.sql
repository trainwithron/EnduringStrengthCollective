-- UNDO: step 214. Puts the cancel function and the two training-max estimate writers back exactly as they were live on Nov 20 (copies in scripts/sql-tests/fixtures), removes the
-- give-back, late-cancel and tested-max functions and the four columns. A tested max a coach typed stays as the athlete's training max, unlocked, so the estimates take over again.
-- The day-before reminder simply stops (the job skips it without the column).

begin;

CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund_credit(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_state text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_attended_at timestamptz;
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
  v_late boolean := false;
  v_athlete_name text;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to cancel this booking';
  end if;

  select athlete_id, group_id, coach_id, status, credit_state, start_at, end_at, attended_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_state, v_start_at, v_end_at, v_attended_at
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id and not public.is_group_coach(v_group_id) then
    raise exception 'not authorized to cancel this booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a cancellable state';
  end if;

  v_is_athlete_cancelling := auth.uid() = v_athlete_id;

  -- A client cannot cancel a session that has started or was already marked attended (that would hand back a credit for a session that happened).
  if v_is_athlete_cancelling and not coalesce(public.is_group_coach(v_group_id), false)
     and (v_attended_at is not null or v_start_at <= now()) then
    raise exception 'this session has already started; ask your coach';
  end if;

  -- FIX 3 (0428): a late move the coach charged is this visit's one session. The client cancelling it afterwards (even after moving it again) gets nothing back and it is
  -- not flagged again. (A coach cancelling it gives the session back below, as any coach cancellation does.)
  if v_is_athlete_cancelling and not coalesce(public.is_group_coach(v_group_id), false)
     and public.booking_late_move_charged(p_booking_id) then
    -- A later late move still waiting for the coach is settled by this one: the earlier charge stands.
    update public.bookings set status = 'cancelled', late_charge_state = case when late_charge_state = 'flagged' then 'charged' else late_charge_state end where id = p_booking_id;
    perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
    return;
  end if;

  if v_is_athlete_cancelling then
    select coalesce(
      (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
      24
    ) into v_window_hours;
    v_should_refund := (v_start_at - now()) >= make_interval(hours => v_window_hours);
  else
    v_should_refund := true;
  end if;

  -- A session the coach already waived (credit_state 'waived') is never flagged: they chose not to charge it.
  v_late := v_is_athlete_cancelling and not v_should_refund and v_state in ('prepaid', 'settled', 'unsettled');

  update public.bookings set status = 'cancelled' where id = p_booking_id;
  -- FIX 3 (0428): the coach cancelling gives the session back, so a late move still waiting for Charge or Waive has nothing left to decide.
  if not v_is_athlete_cancelling then
    update public.bookings set late_charge_state = 'waived' where id = p_booking_id and late_charge_state = 'flagged';
  end if;

  if v_late then
    -- A client cancelling inside the window is FLAGGED for the coach, who decides whether it counts (Charge or Waive). Nothing is taken
    -- automatically: a credit already taken at booking is given back, and the coach can take it again with Charge.
    update public.bookings
      set late_cancel = true, late_change_kind = 'cancel', late_charge_state = 'flagged'
      where id = p_booking_id;
    if v_state in ('prepaid', 'settled') and least(1, public.booking_taken(p_booking_id)) > 0 then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, least(1, public.booking_taken(p_booking_id)), 'refund', 'Booking cancelled inside the window; your coach decides if it counts', p_booking_id, auth.uid());
    end if;
    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach_id, v_group_id, 'late_change',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A client') || ' cancelled a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  elsif v_state in ('prepaid', 'settled') then
    -- A credit was taken for this booking and the cancellation is in time (or made by the coach): it comes back. FIX 3 (0428): only what it actually took (a 'prepaid'
    -- booking that never took a session gives nothing back).
    if v_should_refund and least(1, public.booking_taken(p_booking_id)) > 0 then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, least(1, public.booking_taken(p_booking_id)), 'refund', 'Booking cancelled', p_booking_id, auth.uid());
    end if;
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_training_max()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_exercise_name text;
  v_athlete_id uuid;
  v_historical boolean;
  v_reserve_reps numeric;
  v_estimate numeric;
  v_rpe numeric;
  v_rpe_assumed boolean;
begin
  if new.status <> 'completed' or new.weight is null or new.reps is null
     or new.weight <= 0 or new.reps <= 0 or new.reps > 8
     or new.set_type not in ('working', 'amrap', 'backoff') then
    return new;
  end if;
  if coalesce(new.is_historical, false) then
    return new;
  end if;

  if new.rpe is null then
    v_rpe := 9;
    v_rpe_assumed := true;
  else
    v_rpe := new.rpe;
    v_rpe_assumed := false;
  end if;

  select se.exercise_name, s.athlete_id, s.is_historical into v_exercise_name, v_athlete_id, v_historical
  from public.session_exercises se
  join public.athlete_sessions s on s.id = se.session_id
  where se.id = new.session_exercise_id;

  if v_exercise_name is null or v_athlete_id is null or coalesce(v_historical, false) then
    return new;
  end if;

  v_reserve_reps := greatest(0, 10 - v_rpe);
  v_estimate := round((new.weight * (1 + (new.reps + v_reserve_reps) / 30.0))::numeric, 1);

  insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe, source_rpe_assumed, updated_at)
  values (v_athlete_id, v_exercise_name, v_estimate, new.weight, new.reps, v_rpe, v_rpe_assumed, now())
  on conflict (athlete_id, exercise_name) do update
    set estimated_max = excluded.estimated_max,
        source_weight = excluded.source_weight,
        source_reps = excluded.source_reps,
        source_rpe = excluded.source_rpe,
        source_rpe_assumed = excluded.source_rpe_assumed,
        updated_at = excluded.updated_at
    where excluded.estimated_max > public.athlete_training_maxes.estimated_max;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_training_maxes_internal(p_athlete uuid, p_exercise text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer := 0;
begin
  with counted as (
    select se.exercise_name, sl.weight, sl.reps, coalesce(sl.rpe, 9) as rpe, (sl.rpe is null) as rpe_assumed, sl.completed_at,
           round((sl.weight * (1 + (sl.reps + greatest(0, 10 - coalesce(sl.rpe, 9))) / 30.0))::numeric, 1) as estimate
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions s on s.id = se.session_id
    where s.athlete_id = p_athlete
      and sl.status = 'completed'
      and sl.weight > 0
      and sl.reps >= 1
      and sl.set_type in ('working', 'amrap', 'backoff')
      and (sl.data_flag is null or sl.data_flag = 'accepted')
      and (p_exercise is null or se.exercise_name = p_exercise)
  ),
  best_low as (
    select distinct on (exercise_name) exercise_name, weight, reps, rpe, rpe_assumed, completed_at, estimate
    from counted
    where reps <= 8
    order by exercise_name, estimate desc, completed_at desc nulls last
  ),
  best_high as (
    select distinct on (exercise_name) exercise_name, weight, reps, rpe, rpe_assumed, completed_at, estimate
    from counted
    where reps > 8
    order by exercise_name, estimate desc, completed_at desc nulls last
  ),
  candidates as (
    select exercise_name, estimate, weight, reps, rpe, rpe_assumed, completed_at from best_low
    union all
    -- a stored max that rests on sets of more than 8 reps (the earlier rules allowed any number of reps) is kept, down to what those sets still support; a NEW max never comes from such a set
    select bh.exercise_name,
           least(bh.estimate, m.estimated_max),
           case when m.estimated_max <= bh.estimate then m.source_weight else bh.weight end,
           case when m.estimated_max <= bh.estimate then m.source_reps else bh.reps end,
           case when m.estimated_max <= bh.estimate then m.source_rpe else bh.rpe end,
           case when m.estimated_max <= bh.estimate then m.source_rpe_assumed else bh.rpe_assumed end,
           bh.completed_at
    from best_high bh
    join public.athlete_training_maxes m on m.athlete_id = p_athlete and m.exercise_name = bh.exercise_name
  ),
  best as (
    select distinct on (exercise_name) exercise_name, weight, reps, rpe, rpe_assumed, estimate
    from candidates
    order by exercise_name, estimate desc, completed_at desc nulls last
  ),
  gone as (
    delete from public.athlete_training_maxes m
    where m.athlete_id = p_athlete
      and (p_exercise is null or m.exercise_name = p_exercise)
      and not exists (select 1 from best b where b.exercise_name = m.exercise_name)
    returning 1
  ),
  put as (
    insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe, source_rpe_assumed, updated_at)
    select p_athlete, b.exercise_name, b.estimate, b.weight, b.reps, b.rpe, b.rpe_assumed, now() from best b
    on conflict (athlete_id, exercise_name) do update
      set estimated_max = excluded.estimated_max,
          source_weight = excluded.source_weight,
          source_reps = excluded.source_reps,
          source_rpe = excluded.source_rpe,
          source_rpe_assumed = excluded.source_rpe_assumed,
          updated_at = case when public.athlete_training_maxes.estimated_max is distinct from excluded.estimated_max then excluded.updated_at else public.athlete_training_maxes.updated_at end
    returning 1
  )
  select (select count(*) from put) + (select count(*) from gone) into v_count;
  return v_count;
end;
$function$;

drop function if exists public.take_late_cancel_session(uuid);
drop function if exists public.give_back_late_cancel(uuid);
drop function if exists public.set_tested_max(uuid, text, numeric);
drop function if exists public.unlock_tested_max(uuid, text);
alter table public.bookings drop column if exists day_before_reminded_for, drop column if exists late_charge_auto;
alter table public.coach_booking_policies drop column if exists late_cancel_takes_session;
alter table public.athlete_training_maxes drop column if exists locked, drop column if exists tested_by, drop column if exists tested_at;

commit;
