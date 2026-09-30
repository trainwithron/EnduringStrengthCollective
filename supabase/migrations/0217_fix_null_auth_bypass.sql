-- critical_null_auth_bypass_vulnerability_sept30.md — Postgres/PL/pgSQL
-- treats a NULL boolean in `IF ... THEN ... END IF;` as false (block
-- silently skipped, no error). auth.uid() returns NULL for a fully
-- unauthenticated (anon) caller, so every one of these SECURITY DEFINER
-- functions' identity checks — written as `auth.uid() <> x` / `= x` —
-- silently passed through for anon, because `NULL <> x` and `NULL = x`
-- both evaluate to NULL, not true/false. Proven directly via
-- `select ('x'::uuid <> null::uuid)` returning NULL, not false.
--
-- Fix: add an explicit `if auth.uid() is null then raise exception ...`
-- guard as the first statement in every affected function — the same
-- pattern already used correctly elsewhere in this codebase
-- (create_organization_with_group's `elsif auth.uid() is not null ...
-- else raise exception` branch). Every comparison against auth.uid()
-- later in each function is unaffected in behavior for a real
-- authenticated caller; only the anon/NULL case changes, from "silently
-- allowed" to "explicitly rejected."
--
-- Scope: the 11 confirmed-exploitable functions from the full 56-function
-- sweep, plus offer_freed_slot_to_waitlist (had zero auth check of any
-- kind — lower severity, spam/nuisance only, fixed in the same pass).

create or replace function public.transfer_organization_ownership(p_organization_id uuid, p_new_owner_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authorized to transfer organization ownership';
  end if;

  select owner_id into v_current_owner from public.organizations where id = p_organization_id;
  if v_current_owner is null then
    raise exception 'Organization not found';
  end if;

  if v_current_owner <> auth.uid()
     and not exists (select 1 from public.profiles where id = auth.uid() and is_platform_admin)
  then
    raise exception 'Only the current owner or a platform admin can transfer ownership';
  end if;

  if p_new_owner_id = v_current_owner then
    raise exception 'That person already owns this organization';
  end if;

  if not exists (
    select 1 from public.organization_memberships
    where organization_id = p_organization_id and profile_id = p_new_owner_id
  ) then
    raise exception 'The new owner must already be a member of this organization';
  end if;

  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;
  update public.organization_memberships set role = 'owner'
    where organization_id = p_organization_id and profile_id = p_new_owner_id;
  update public.organization_memberships set role = 'admin'
    where organization_id = p_organization_id and profile_id = v_current_owner;
end;
$function$;

create or replace function public.adjust_session_credits(p_athlete_id uuid, p_group_id uuid, p_delta integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  new_balance int;
begin
  if auth.uid() is null then
    raise exception 'Not authorized to adjust these session credits';
  end if;

  if auth.uid() = p_athlete_id and p_delta > 0 then
    raise exception 'not authorized to increase your own session credits directly';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to adjust these session credits';
  end if;

  insert into public.session_credits (athlete_id, group_id, balance, last_granted_at)
  values (p_athlete_id, p_group_id, greatest(0, p_delta), case when p_delta > 0 then now() else null end)
  on conflict (athlete_id, group_id)
  do update set
    balance = greatest(0, public.session_credits.balance + p_delta),
    last_granted_at = case when p_delta > 0 then now() else public.session_credits.last_granted_at end,
    updated_at = now()
  returning balance into new_balance;

  return new_balance;
end;
$function$;

create or replace function public.reschedule_booking(p_booking_id uuid, p_new_start_at timestamp with time zone, p_new_end_at timestamp with time zone)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_window_hours int;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  if auth.uid() is null then
    raise exception 'Not authorized to reschedule this booking';
  end if;

  select athlete_id, group_id, coach_id, status, start_at, end_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at, v_end_at
  from public.bookings where id = p_booking_id;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id then
    raise exception 'not authorized to reschedule this booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a reschedulable state';
  end if;

  if p_new_end_at <= p_new_start_at then
    raise exception 'invalid time range';
  end if;

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = v_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if (p_new_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.coach_id = v_coach_id
      and b.id <> p_booking_id
      and b.status = 'confirmed'
      and b.start_at < (p_new_end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (p_new_start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = v_coach_id
      and d.status = 'confirmed'
      and d.start_at < (p_new_end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (p_new_start_at - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;

  select coalesce(
    (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
    24
  ) into v_window_hours;

  update public.bookings
    set start_at = p_new_start_at, end_at = p_new_end_at, reminder_sent_at = null
    where id = p_booking_id;

  if (v_start_at - now()) < make_interval(hours => v_window_hours) then
    perform public.adjust_session_credits(v_athlete_id, v_group_id, -1);
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

create or replace function public.increment_pro_shop_click(p_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_coach_id uuid;
  new_count int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  select coach_id into v_coach_id from public.pro_shop_links where id = p_id;
  if v_coach_id is null then
    raise exception 'pro shop link not found';
  end if;
  if auth.uid() <> v_coach_id and not public.is_client_of_coach(v_coach_id) then
    raise exception 'not authorized';
  end if;

  update public.pro_shop_links
    set click_count = click_count + 1
    where id = p_id
    returning click_count into new_count;

  return new_count;
end;
$function$;

create or replace function public.increment_referral_click(p_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_coach_id uuid;
  new_count int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  select coach_id into v_coach_id from public.referral_partners where id = p_id;
  if v_coach_id is null then
    raise exception 'referral partner not found';
  end if;
  if auth.uid() <> v_coach_id and not public.is_client_of_coach(v_coach_id) then
    raise exception 'not authorized';
  end if;

  update public.referral_partners
    set click_count = click_count + 1
    where id = p_id
    returning click_count into new_count;

  return new_count;
end;
$function$;

create or replace function public.complete_workout_session(p_session_id uuid)
 returns TABLE(workout_log_id uuid, athlete_id uuid, group_id uuid, total_volume numeric, total_sets_completed integer, new_prs text[], new_records text[], credit_consumed boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_session record;
  v_completed_at timestamptz := now();
  v_duration int;
  v_total_volume numeric;
  v_total_sets int;
  v_new_prs text[];
  v_new_records text[];
  v_log_id uuid;
  v_credit_consumed boolean := false;
  v_credit_cost int;
begin
  if auth.uid() is null then
    raise exception 'not authorized to complete this session';
  end if;

  select * into v_session from public.athlete_sessions where id = p_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  if auth.uid() <> v_session.athlete_id and not public.is_group_coach(v_session.group_id) then
    raise exception 'not authorized to complete this session';
  end if;

  v_duration := extract(epoch from (v_completed_at - v_session.started_at))::int;

  update public.athlete_sessions
    set status = 'completed', completed_at = v_completed_at, duration_seconds = v_duration
    where id = p_session_id;

  select coalesce(sum(sl.weight * sl.reps), 0), count(*)
    into v_total_volume, v_total_sets
  from public.set_logs sl
  join public.session_exercises se on se.id = sl.session_exercise_id
  where se.session_id = p_session_id and sl.status = 'completed';

  with combined_best as (
    select se.exercise_name as name,
      max(sl.weight) as best_weight,
      max(sl.distance) as best_distance,
      min(sl.time_seconds) as best_time,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end) as best_pace_seconds
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
    group by se.exercise_name
  ),
  prior_best as (
    select se.exercise_name as name,
      max(sl.weight) as best_weight,
      max(sl.distance) as best_distance,
      min(sl.time_seconds) as best_time,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end) as best_pace_seconds
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions asx on asx.id = se.session_id
    where asx.athlete_id = v_session.athlete_id
      and se.session_id <> p_session_id
      and sl.status = 'completed'
    group by se.exercise_name
  )
  select coalesce(array_agg(distinct cb.name), '{}')
    into v_new_prs
  from combined_best cb
  join prior_best pb on pb.name = cb.name
  where (cb.best_weight is not null and pb.best_weight is not null and cb.best_weight > pb.best_weight)
     or (cb.best_distance is not null and pb.best_distance is not null and cb.best_distance > pb.best_distance)
     or (cb.best_time is not null and pb.best_time is not null and cb.best_time < pb.best_time)
     or (cb.best_pace_seconds is not null and pb.best_pace_seconds is not null and cb.best_pace_seconds < pb.best_pace_seconds);

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  select coalesce(array_agg(distinct b.name), '{}') into v_new_records from broken b;

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  update public.exercise_records er
    set superseded_at = v_completed_at
    from broken b
    where er.group_id = v_session.group_id and er.superseded_at is null
      and er.exercise_name = b.name and er.tracked_field = b.tracked_field;

  with candidate_bests as (
    select 'weight'::text as tracked_field, 'higher_better'::text as direction,
      se.exercise_name as name, max(sl.weight) as best,
      (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name

    union all

    select 'distance', 'higher_better',
      se.exercise_name, max(sl.distance),
      (array_agg(sl.id order by sl.distance desc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.distance is not null
    group by se.exercise_name

    union all

    select 'time_seconds', 'lower_better',
      se.exercise_name, min(sl.time_seconds),
      (array_agg(sl.id order by sl.time_seconds asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.time_seconds is not null
    group by se.exercise_name

    union all

    select 'pace_seconds', 'lower_better',
      se.exercise_name,
      min(case
        when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
          then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
        when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
          then sl.pace::numeric
        else null
      end),
      (array_agg(sl.id order by (case
          when sl.pace ~ '^[0-9]+:[0-5]?[0-9]$'
            then split_part(sl.pace, ':', 1)::numeric * 60 + split_part(sl.pace, ':', 2)::numeric
          when sl.pace ~ '^[0-9]+(\.[0-9]+)?$'
            then sl.pace::numeric
          else null
        end) asc nulls last))[1]
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
      and (sl.pace ~ '^[0-9]+:[0-5]?[0-9]$' or sl.pace ~ '^[0-9]+(\.[0-9]+)?$')
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, tracked_field, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and superseded_at is null
  ),
  broken as (
    select cb.tracked_field, cb.direction, cb.name, cb.best, cb.best_set_log_id
    from candidate_bests cb
    left join current_records cr
      on cr.exercise_name = cb.name and cr.tracked_field = cb.tracked_field
    where cr.exercise_name is null
       or (cb.direction = 'higher_better' and cb.best > cr.value)
       or (cb.direction = 'lower_better' and cb.best < cr.value)
  )
  insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, set_log_id, achieved_at)
  select v_session.group_id, b.name, b.tracked_field, b.direction, b.best, v_session.athlete_id, b.best_set_log_id, v_completed_at
  from broken b;

  insert into public.workout_logs (
    session_id, athlete_id, group_id, workout_id,
    total_duration_seconds, total_volume, total_sets_completed, new_prs, logged_by_coach
  ) values (
    p_session_id, v_session.athlete_id, v_session.group_id, v_session.workout_id,
    v_duration, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), v_session.logged_by_coach
  )
  returning id into v_log_id;

  v_credit_cost := 1;
  if v_session.session_type_id is not null then
    select credit_cost into v_credit_cost from public.session_types where id = v_session.session_type_id;
    if v_credit_cost is null then
      v_credit_cost := 1;
    end if;
  end if;

  if v_session.logged_by_coach and v_credit_cost > 0 then
    update public.session_credits
      set balance = greatest(0, balance - v_credit_cost), updated_at = v_completed_at
      where session_credits.athlete_id = v_session.athlete_id and session_credits.group_id = v_session.group_id;
    if found then
      v_credit_consumed := true;
    end if;
  end if;

  return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), coalesce(v_new_records, '{}'), v_credit_consumed;
end;
$function$;

create or replace function public.join_booking_waitlist(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_slot_start_at timestamp with time zone, p_slot_end_at timestamp with time zone)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_entry_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized to join this waitlist';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to join this waitlist';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  if not exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id and b.status = 'confirmed'
      and b.start_at = p_slot_start_at and b.end_at = p_slot_end_at
  ) then
    raise exception 'that slot is not currently booked';
  end if;

  insert into public.booking_waitlist_entries (coach_id, athlete_id, group_id, slot_start_at, slot_end_at)
  values (p_coach_id, p_athlete_id, p_group_id, p_slot_start_at, p_slot_end_at)
  on conflict (athlete_id, coach_id, slot_start_at) do update
    set status = 'waiting', offered_at = null, offer_expires_at = null, push_sent_at = null
    where booking_waitlist_entries.status in ('expired', 'cancelled')
  returning id into v_entry_id;

  if v_entry_id is null then
    select id into v_entry_id from public.booking_waitlist_entries
      where athlete_id = p_athlete_id and coach_id = p_coach_id and slot_start_at = p_slot_start_at;
  end if;

  return v_entry_id;
end;
$function$;

create or replace function public.book_session(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_is_self boolean;
  v_balance int;
  v_booking_id uuid;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  if auth.uid() is null then
    raise exception 'not authorized to book this session';
  end if;

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

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = p_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if v_is_self and (p_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
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
      and b.start_at < (p_end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (p_start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = p_coach_id
      and d.status = 'confirmed'
      and d.start_at < (p_end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (p_start_at - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;

  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status)
  values (p_coach_id, p_athlete_id, p_group_id, p_start_at, p_end_at, 'confirmed')
  returning id into v_booking_id;

  perform public.adjust_session_credits(p_athlete_id, p_group_id, -1);

  update public.booking_waitlist_entries
    set status = case when athlete_id = p_athlete_id then 'claimed' else 'expired' end
    where coach_id = p_coach_id
      and slot_start_at = p_start_at
      and slot_end_at = p_end_at
      and status in ('waiting', 'offered');

  return v_booking_id;
end;
$function$;

create or replace function public.cancel_booking_and_refund_credit(p_booking_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
begin
  if auth.uid() is null then
    raise exception 'not authorized to cancel this booking';
  end if;

  select athlete_id, group_id, coach_id, status, start_at, end_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at, v_end_at
  from public.bookings where id = p_booking_id;

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

  if v_is_athlete_cancelling then
    select coalesce(
      (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
      24
    ) into v_window_hours;
    v_should_refund := (v_start_at - now()) >= make_interval(hours => v_window_hours);
  else
    v_should_refund := true;
  end if;

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  if v_should_refund then
    insert into public.session_credits (athlete_id, group_id, balance)
    values (v_athlete_id, v_group_id, 1)
    on conflict (athlete_id, group_id)
    do update set balance = public.session_credits.balance + 1, updated_at = now();
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

create or replace function public.create_recurring_booking_series(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_first_start_at timestamp with time zone, p_duration_minutes integer, p_occurrences_total integer)
 returns TABLE(series_id uuid, booked_count integer, failed_count integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_series_id uuid;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_new_booking_id uuid;
  v_booked int := 0;
  v_failed int := 0;
  i int;
begin
  if auth.uid() is null then
    raise exception 'not authorized to create this booking series';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to create this booking series';
  end if;
  if p_occurrences_total <= 0 or p_occurrences_total > 12 then
    raise exception 'occurrences_total must be between 1 and 12';
  end if;

  insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes, occurrences_total)
  values (p_coach_id, p_athlete_id, p_group_id, extract(dow from p_first_start_at)::smallint, p_first_start_at::time, p_duration_minutes, p_occurrences_total)
  returning id into v_series_id;

  for i in 0..(p_occurrences_total - 1) loop
    v_start_at := p_first_start_at + (i * interval '7 days');
    v_end_at := v_start_at + make_interval(mins => p_duration_minutes);
    begin
      v_new_booking_id := public.book_session(p_coach_id, p_athlete_id, p_group_id, v_start_at, v_end_at);
      update public.bookings set recurring_series_id = v_series_id where id = v_new_booking_id;
      v_booked := v_booked + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return query select v_series_id, v_booked, v_failed;
end;
$function$;

create or replace function public.cancel_recurring_booking_series(p_series_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_booking record;
  v_cancelled int := 0;
begin
  if auth.uid() is null then
    raise exception 'not authorized to cancel this series';
  end if;

  select athlete_id, group_id into v_athlete_id, v_group_id
  from public.recurring_booking_series where id = p_series_id;

  if v_athlete_id is null then
    raise exception 'series not found';
  end if;
  if auth.uid() <> v_athlete_id and not public.is_group_coach(v_group_id) then
    raise exception 'not authorized to cancel this series';
  end if;

  update public.recurring_booking_series set status = 'cancelled' where id = p_series_id;

  for v_booking in
    select id from public.bookings
    where recurring_series_id = p_series_id and status = 'confirmed' and start_at > now()
  loop
    perform public.cancel_booking_and_refund_credit(v_booking.id);
    v_cancelled := v_cancelled + 1;
  end loop;

  return v_cancelled;
end;
$function$;

-- Lower-severity addendum: had zero auth check of any kind. Not
-- identity-checked against a specific person (any group member can
-- legitimately trigger this indirectly via cancel/reschedule), but an
-- anon caller could spam a real athlete with a fake "a spot opened up"
-- notification. Fixed by requiring an authenticated member of the
-- waitlist entry's own group — silently no-ops otherwise (this is a
-- `perform`ed fire-and-forget helper; raising here would abort the
-- caller's own transaction).
create or replace function public.offer_freed_slot_to_waitlist(p_coach_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_entry record;
begin
  select * into v_entry from public.booking_waitlist_entries
    where coach_id = p_coach_id and slot_start_at = p_start_at and slot_end_at = p_end_at and status = 'waiting'
    order by created_at asc
    limit 1;

  if v_entry.id is null then
    return;
  end if;

  if auth.uid() is null or not public.is_group_member(v_entry.group_id) then
    return;
  end if;

  update public.booking_waitlist_entries
    set status = 'offered', offered_at = now(), offer_expires_at = now() + interval '30 minutes'
    where id = v_entry.id;

  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (
    v_entry.athlete_id,
    v_entry.group_id,
    'waitlist_slot_offered',
    'A spot just opened up for ' || to_char(p_start_at, 'Dy Mon DD, HH12:MI AM') || ' — book now before it''s gone.',
    '/groups/' || v_entry.group_id || '/calendar/' || to_char(p_start_at, 'YYYY-MM-DD')
  );
end;
$function$;
