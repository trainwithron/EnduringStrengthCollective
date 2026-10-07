-- RELEASE F: ONE paste. Steps 35, 36, 37 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 35: Nothing changes for normal use. A coach can no longer swap the person on an existing membership; the AI routes (deployed in the same release) charge credits from the server with the server's own numbers; an athlete's form-check video and a coach's video check-in can be opened only by that person and the group's coaches; clients who joined by invite link and have signed in stop showing 'Not signed in yet' and can no longer be given a coach-made login link. Deploy the release right after this paste: until the new code is live, charging AI credits fails with 'Couldn't process credits' (the AI is down today anyway).
-- AFTER STEP 36: Nothing changes for normal use. A coach can no longer put a booking on another coach's calendar, and a client can no longer spend one group's credit on another coach's calendar. A client who tries to cancel or move a session that has started (or that the coach marked attended) is told to ask their coach; cancelling or moving a future session works as before and a coach is never refused. The nightly expiry (code in the same release) now takes off only what is truly unused (sessions booked ahead or not yet marked are kept) and does it in one locked step; until the new code is live the old job still runs as before. Run after step 35.
-- AFTER STEP 37: Nothing visible changes. After the code deploy every failed AI call records a short class (key rejected, credit or spend limit, rate limit, overloaded, timeout, bad request, unknown) and the nightly AI jobs show as failed when every item failed. Run after step 36.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release F, step 35: 0290 four database closures: a membership can no longer be handed to another person, the two AI-credit spending functions are server-only and refuse negative amounts, two private video buckets are readable only by the person they belong to and the coaches, and a client who joined by invite link is marked as signed in
do $g35$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('group_memberships, coach_credits and session_exercise_videos exist', to_regclass('public.group_memberships') is not null and to_regclass('public.coach_credits') is not null and to_regclass('public.session_exercise_videos') is not null),
      ('spend_ai_action, spend_coach_credits, audit_blocked exist', exists (select 1 from pg_proc where proname = 'spend_ai_action' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'spend_coach_credits' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'audit_blocked' and pronamespace = 'public'::regnamespace)),
      ('0290 is not already applied (the membership identity guard is not there yet)', not exists (select 1 from pg_trigger where tgname = 'group_memberships_guard_identity'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release F, step 35 (0290) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g35$;

-- ====================================================================================================
-- migration 0290_release_f_security_guards.sql
-- ====================================================================================================

-- Release F, part 1: four small database closures from the Assistant's Oct 7 audit (r2_02a H1, H2, M2; r2_03a H2; r2_05 ONB-01). Nothing here changes what the app
-- does for a normal person; each one removes a way to do something the app never does.
--
-- 1. A coach could re-point an existing membership row at ANY signed-in person (update group_memberships set profile_id = <someone>), which re-opens exactly the
--    hole 0270 closed (the "athlete" then appears in the coach's view with their phone number, wearable data and push keys). Nothing in the app ever changes
--    profile_id on a membership, so a BEFORE UPDATE trigger now refuses it for a signed-in caller (the server and the database owner are unaffected).
-- 2. spend_coach_credits() accepted a negative cost, so any signed-in account could ADD AI credits to its own balance. The function has no caller in the app.
--    It now refuses a negative or missing cost and, like the other money functions, only the server can run it.
-- 3. spend_ai_action() trusted the allowance and the cost sent by the browser (a metered coach could send "allowance 1000000" or a negative cost). It is now
--    server-only: the AI routes call it with the service role, after they have checked who is signed in, and the numbers come from the server's own table.
--    It still refuses a negative or missing amount. (lib/coach-credits.ts is changed in the same release to call it with the service role.)
-- 4. Two private video buckets (an athlete's form-check videos, a coach's video check-ins) could be read by every member of the group. They are now readable by
--    the person they belong to and the group's coaches, which is what the tables already said.
-- 5. A client who joined by invite link was never marked as having claimed their account (the profile guard of 0266 forced claimed_at to null on every browser
--    insert), so the coach saw "Not signed in yet" and could mint a login link for them. A person who is signed in and creating their own profile HAS claimed it,
--    so the guard now stamps the time. Coach-created accounts are inserted by the server with claimed_at null and are not touched. People who already joined
--    this way and have signed in are backfilled.
-- Re-runnable.

-- 1 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.guard_membership_identity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and new.profile_id is distinct from old.profile_id then
    raise exception 'A membership cannot be handed to another person. Remove it and add them properly.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists group_memberships_guard_identity on public.group_memberships;
create trigger group_memberships_guard_identity
  before update of profile_id on public.group_memberships
  for each row execute function public.guard_membership_identity();

-- 2 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.spend_coach_credits(p_coach_id uuid, p_cost integer)
returns table(spent boolean, new_balance integer, unlimited boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance int;
  v_mode text;
begin
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null then
      raise exception 'Not authorized to spend these credits';
    elsif auth.uid() <> p_coach_id then
      raise exception 'Not authorized to spend these credits';
    end if;
  end if;
  if p_cost is null or p_cost < 0 then
    raise exception 'The cost must be zero or more';
  end if;

  select c.balance, c.ai_access_mode into v_balance, v_mode
  from public.coach_credits c
  where c.coach_id = p_coach_id
  for update;

  if v_mode = 'unlimited' then
    return query select true, coalesce(v_balance, 0), true;
    return;
  end if;

  v_balance := coalesce(v_balance, 0);

  if v_balance < p_cost then
    return query select false, v_balance, false;
    return;
  end if;

  update public.coach_credits c
  set balance = c.balance - p_cost, updated_at = now()
  where c.coach_id = p_coach_id
  returning c.balance into v_balance;

  return query select true, v_balance, false;
end;
$function$;

revoke all on function public.spend_coach_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.spend_coach_credits(uuid, integer) to service_role;

-- 3 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.spend_ai_action(p_coach_id uuid, p_action text, p_credit_cost integer, p_allowance integer)
returns table(spent boolean, source text, new_balance integer, allowance_remaining integer, unlimited boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance int;
  v_mode text;
  v_period date;
  v_prog int;
  v_meal int;
  v_used int;
  v_allowance int;
  v_month date := (date_trunc('month', now() at time zone 'utc'))::date;
begin
  -- Server only: the route has already checked who is signed in and passes the coach's own id and the server's own numbers.
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized to spend these credits';
  end if;
  if p_coach_id is null or p_credit_cost is null or p_credit_cost < 0 or p_allowance is null or p_allowance < 0 then
    raise exception 'Invalid amount';
  end if;

  insert into public.coach_credits (coach_id) values (p_coach_id) on conflict (coach_id) do nothing;

  select c.balance, c.ai_access_mode, c.allowance_period, c.program_used, c.mealplan_used
    into v_balance, v_mode, v_period, v_prog, v_meal
  from public.coach_credits c
  where c.coach_id = p_coach_id
  for update;

  if v_period is distinct from v_month then
    v_prog := 0;
    v_meal := 0;
    update public.coach_credits
      set allowance_period = v_month, program_used = 0, mealplan_used = 0
      where coach_id = p_coach_id;
  end if;

  if v_mode = 'unlimited' then
    if p_action in ('program_generation', 'nutrition_plan', 'ci_overview') then
      insert into public.ai_charges (coach_id, action, source, credits_charged)
      values (p_coach_id, p_action, 'unlimited', 0);
    end if;
    return query select true, 'unlimited'::text, v_balance, 0, true;
    return;
  end if;

  v_used := case p_action
    when 'program_generation' then v_prog
    when 'nutrition_plan' then v_meal
    else null
  end;
  v_allowance := ceil(p_allowance * public.coach_ai_multiplier(p_coach_id));

  if v_used is not null and p_allowance > 0 and v_used < v_allowance then
    if p_action = 'program_generation' then
      update public.coach_credits set program_used = program_used + 1, updated_at = now() where coach_id = p_coach_id;
    else
      update public.coach_credits set mealplan_used = mealplan_used + 1, updated_at = now() where coach_id = p_coach_id;
    end if;
    insert into public.ai_charges (coach_id, action, source, credits_charged)
    values (p_coach_id, p_action, 'allowance', 0);
    return query select true, 'allowance'::text, v_balance, v_allowance - v_used - 1, false;
    return;
  end if;

  if v_balance < p_credit_cost then
    return query select false, 'none'::text, v_balance, 0, false;
    return;
  end if;

  update public.coach_credits
    set balance = balance - p_credit_cost, updated_at = now()
    where coach_id = p_coach_id
    returning balance into v_balance;

  insert into public.ai_charges (coach_id, action, source, credits_charged)
  values (p_coach_id, p_action, 'credits', p_credit_cost);

  return query select true, 'credits'::text, v_balance, 0, false;
end;
$function$;

revoke all on function public.spend_ai_action(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.spend_ai_action(uuid, text, integer, integer) to service_role;

-- 4 ------------------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "athlete_exercise_videos_select_members" on storage.objects;
drop policy if exists "athlete_exercise_videos_select_own_or_coach" on storage.objects;
create policy "athlete_exercise_videos_select_own_or_coach" on storage.objects for select to authenticated
  using (
    bucket_id = 'athlete-exercise-videos'
    and (
      owner = (select auth.uid())
      or case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.is_group_coach(((storage.foldername(name))[1])::uuid) else false end
      or exists (select 1 from public.session_exercise_videos v where v.video_path = name and v.athlete_id = (select auth.uid()))
    )
  );

drop policy if exists "coach_video_checkins_select_members" on storage.objects;
drop policy if exists "coach_video_checkins_select_recipient_or_coach" on storage.objects;
create policy "coach_video_checkins_select_recipient_or_coach" on storage.objects for select to authenticated
  using (
    bucket_id = 'coach-video-checkins'
    and (
      case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.is_group_coach(((storage.foldername(name))[1])::uuid) else false end
      or (storage.foldername(name))[2] = (select auth.uid())::text
    )
  );

-- 5 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.guard_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- A person creating their own profile while signed in has claimed their account (coach-created accounts are inserted by the server, with claimed_at null).
      perform public.audit_blocked('profiles', new.id::text, jsonb_build_object('is_platform_admin', false, 'intake_required', true), to_jsonb(new), array['is_platform_admin', 'intake_required']);
      new.is_platform_admin := false;
      new.claimed_at := now();
      new.intake_required := true;
    else
      perform public.audit_blocked('profiles', old.id::text, to_jsonb(old), to_jsonb(new), array['intake_required', 'claimed_at']);
      new.intake_required := old.intake_required;
      new.claimed_at := old.claimed_at;
    end if;
  end if;
  return new;
end;
$function$;

-- Backfill: someone who joined by invite link before this fix has signed in (their sign-in time is on their login) but was never stamped. Accounts a coach made
-- for a client (placeholder address, never signed in) are left alone.
update public.profiles p
set claimed_at = coalesce(u.last_sign_in_at, p.created_at)
from auth.users u
where u.id = p.id
  and p.claimed_at is null
  and u.last_sign_in_at is not null
  and coalesce(u.email, '') not like '%@pending.invalid';

-- ===== Release F, step 36: 0291 booking and credit closures: a booking, a waiting-list place or a weekly schedule must name a coach who coaches that group, a client cannot cancel or move a session that has already started or been marked attended, and the nightly credit expiry becomes one locked step that takes only an amount
do $g36$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('assert_client_may_book_directly exists (0278 is applied)', exists (select 1 from pg_proc where proname = 'assert_client_may_book_directly' and pronamespace = 'public'::regnamespace)),
      ('bookings, recurring_booking_series and booking_waitlist_entries exist', to_regclass('public.bookings') is not null and to_regclass('public.recurring_booking_series') is not null and to_regclass('public.booking_waitlist_entries') is not null),
      ('the credit functions and expiry record exist (0248 and the expiry table are applied)', exists (select 1 from pg_proc where proname = 'apply_session_credit_change' and pronamespace = 'public'::regnamespace) and to_regclass('public.session_credit_expirations') is not null),
      ('0291 is not already applied (book_session does not check the coach yet)', coalesce((select position('that coach does not coach this group' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace), false))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release F, step 36 (0291) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g36$;

-- ====================================================================================================
-- migration 0291_release_f_booking_guards.sql
-- ====================================================================================================

-- Release F, part 2: booking closures from the Assistant's Oct 7 audit (r2_03a H1 and M3).
--
-- 1. book_session, join_booking_waitlist and create_recurring_booking_series trusted the coach id the caller sent. They never checked that this coach
--    actually coaches the group the booking is for (request_booking already did). Any coach could put a booking on another coach's calendar (including one that
--    coach cannot cancel), and a client could spend one group's credit on another coach's calendar. All three now refuse unless the coach is a coach of the group.
--    The weekly-series function checks first, so it never leaves an empty series row behind.
-- 2. A client could cancel or move a session that had already started, or one the coach had already marked attended, and cancel got the credit back. For the
--    client (not the coach) both now refuse: "this session has already started, ask your coach". A coach is never refused, and cancelling a future session
--    works exactly as before.
-- 3. The nightly credit-expiry job zeroed a whole balance, including sessions already booked ahead or delivered and not yet marked (the client then read "Owed"),
--    in three separate writes that could stop half way. expire_session_credit_balance() takes off an AMOUNT (the job works out how much is truly unused) in one
--    locked step: the balance, the ledger row and the expiry record together, only if the balance is still what the job read. Server only.
-- NOT in this migration (Ron's decision): making a self-booking obey the coach's open hours and a maximum length.
-- Needs 0278/0279 (booking mode) and 0288 (overlap guard). Re-runnable.

-- 1 ------------------------------------------------------------------------------------------------------------------------------------------------------
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
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to book this session';
  end if;

  v_is_self := coalesce(auth.uid() = p_athlete_id, false);

  if not v_is_self and not public.is_group_coach(p_group_id) and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized to book this session';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  if not exists (
    select 1 from public.group_memberships gm
    where gm.group_id = p_group_id and gm.profile_id = p_coach_id and gm.role = 'coach'
  ) then
    raise exception 'that coach does not coach this group';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid time range';
  end if;

  -- The coach's booking mode decides whether a client may book directly (see assert_client_may_book_directly).
  perform public.assert_client_may_book_directly(p_coach_id, p_athlete_id, p_group_id);

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = p_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if v_is_self and (p_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;

  -- Only a client booking for themselves needs a credit. A coach can always schedule.
  if v_is_self then
    select balance into v_balance from public.session_credits
      where athlete_id = p_athlete_id and group_id = p_group_id
      for update;
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

  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state)
  values (p_coach_id, p_athlete_id, p_group_id, p_start_at, p_end_at, 'confirmed',
          case when v_is_self then 'prepaid' else 'unsettled' end)
  returning id into v_booking_id;

  if v_is_self then
    perform public.apply_session_credit_change(p_athlete_id, p_group_id, -1, 'booked', 'Booked a session', v_booking_id, auth.uid());
  end if;

  update public.booking_waitlist_entries
    set status = case when athlete_id = p_athlete_id then 'claimed' else 'expired' end
    where coach_id = p_coach_id
      and slot_start_at = p_start_at
      and slot_end_at = p_end_at
      and status in ('waiting', 'offered');

  return v_booking_id;
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
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to join this waitlist';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to join this waitlist';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  if not exists (
    select 1 from public.group_memberships gm
    where gm.group_id = p_group_id and gm.profile_id = p_coach_id and gm.role = 'coach'
  ) then
    raise exception 'that coach does not coach this group';
  end if;
  perform public.assert_client_may_book_directly(p_coach_id, p_athlete_id, p_group_id);

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

create or replace function public.create_recurring_booking_series(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_first_start_at timestamp with time zone, p_duration_minutes integer, p_occurrences_total integer)
returns table(series_id uuid, booked_count integer, failed_count integer)
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
  v_tz text;
  i int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to create this booking series';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to create this booking series';
  end if;
  if not exists (
    select 1 from public.group_memberships gm
    where gm.group_id = p_group_id and gm.profile_id = p_coach_id and gm.role = 'coach'
  ) then
    raise exception 'that coach does not coach this group';
  end if;
  perform public.assert_client_may_book_directly(p_coach_id, p_athlete_id, p_group_id);
  if p_occurrences_total <= 0 or p_occurrences_total > 52 then
    raise exception 'occurrences_total must be between 1 and 52';
  end if;

  -- The coach's own time zone, so "8:00 every Tuesday" stays 8:00 when the clocks change.
  v_tz := coalesce(public.coach_time_zone(p_coach_id), 'America/New_York');

  insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes, occurrences_total)
  values (p_coach_id, p_athlete_id, p_group_id, extract(dow from p_first_start_at at time zone v_tz)::smallint, (p_first_start_at at time zone v_tz)::time, p_duration_minutes, p_occurrences_total)
  returning id into v_series_id;

  for i in 0..(p_occurrences_total - 1) loop
    v_start_at := ((p_first_start_at at time zone v_tz) + (i * interval '7 days')) at time zone v_tz;
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

-- 2 ------------------------------------------------------------------------------------------------------------------------------------------------------
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

  if v_late then
    -- A client cancelling inside the window is FLAGGED for the coach, who decides whether it counts (Charge or Waive). Nothing is taken
    -- automatically: a credit already taken at booking is given back, and the coach can take it again with Charge.
    update public.bookings
      set late_cancel = true, late_change_kind = 'cancel', late_charge_state = 'flagged'
      where id = p_booking_id;
    if v_state in ('prepaid', 'settled') then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, 1, 'refund', 'Booking cancelled inside the window; your coach decides if it counts', p_booking_id, auth.uid());
    end if;
    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach_id, v_group_id, 'late_change',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A client') || ' cancelled a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  elsif v_state in ('prepaid', 'settled') then
    -- A credit was taken for this booking and the cancellation is in time (or made by the coach): it comes back.
    if v_should_refund then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, 1, 'refund', 'Booking cancelled', p_booking_id, auth.uid());
    end if;
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
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
  v_attended_at timestamptz;
  v_window_hours int;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
  v_athlete_name text;
  v_credit_state text;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'Not authorized to reschedule this booking';
  end if;

  select athlete_id, group_id, coach_id, status, start_at, end_at, credit_state, attended_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at, v_end_at, v_credit_state, v_attended_at
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id then
    raise exception 'not authorized to reschedule this booking';
  end if;
  -- A client moves a session directly only when the coach's booking mode is 'free'. In 'request' mode they ask (request_booking_move);
  -- in 'coach_schedules' mode they message the coach. A coach who is their own client is never refused.
  if not coalesce(public.is_group_coach(v_group_id), false) then
    if public.coach_booking_mode(v_coach_id) = 'request' then
      raise exception 'your coach confirms moves: ask for the new time instead';
    elsif public.coach_booking_mode(v_coach_id) <> 'free' then
      raise exception 'your coach schedules your sessions';
    end if;
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a reschedulable state';
  end if;
  if not coalesce(public.is_group_coach(v_group_id), false) and (v_attended_at is not null or v_start_at <= now()) then
    raise exception 'this session has already started; ask your coach';
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

  if (v_start_at - now()) < make_interval(hours => v_window_hours) and v_credit_state in ('prepaid', 'settled', 'unsettled') then
    -- A late move is FLAGGED for the coach, who decides whether it counts (Charge or Waive). No session is taken automatically.
    update public.bookings
      set late_change_kind = 'reschedule', late_charge_state = 'flagged'
      where id = p_booking_id;
    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach_id, v_group_id, 'late_change',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A client') || ' moved a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

-- 3 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.expire_session_credit_balance(p_athlete_id uuid, p_group_id uuid, p_amount integer, p_expected_balance integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cur int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_amount is null or p_amount <= 0 then
    return false;
  end if;

  select balance into v_cur from public.session_credits
    where athlete_id = p_athlete_id and group_id = p_group_id
    for update;
  -- Only if nothing moved since the job read the balance, and never more than what is there.
  if v_cur is null or v_cur is distinct from p_expected_balance or p_amount > v_cur then
    return false;
  end if;

  perform public.apply_session_credit_change(p_athlete_id, p_group_id, -p_amount, 'expired', 'Unused sessions expired', null, null);
  insert into public.session_credit_expirations (athlete_id, group_id, credits_expired) values (p_athlete_id, p_group_id, p_amount);
  return true;
end;
$function$;

revoke all on function public.expire_session_credit_balance(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.expire_session_credit_balance(uuid, uuid, integer, integer) to service_role;

-- ===== Release F, step 37: 0292 the AI call log records why a call failed (a short error class), so an AI outage can be diagnosed
do $g37$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('ai_usage_log exists', to_regclass('public.ai_usage_log') is not null),
      ('0292 is not already applied (the error_class column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_log' and column_name = 'error_class'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release F, step 37 (0292) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g37$;

-- ====================================================================================================
-- migration 0292_ai_usage_error_class.sql
-- ====================================================================================================

-- Release F, part 3: record WHY an AI call failed (Assistant, Oct 7: every real AI call has failed since Oct 5 18:46 UTC and the database kept no error text, so the
-- cause could not be named). ai_usage_log gets one nullable column, error_class, written by the server when a call fails: a short class such as
-- 'auth' (key rejected), 'credit' (the Anthropic balance or spend limit), 'rate_limit', 'overloaded', 'timeout', 'bad_request' or 'unknown'. It never holds the
-- message or anything the person typed. Nothing reads it yet except the job monitor and Spot. No existing row or caller changes. Re-runnable.

alter table public.ai_usage_log add column if not exists error_class text;
alter table public.ai_usage_log drop constraint if exists ai_usage_log_error_class_len;
alter table public.ai_usage_log add constraint ai_usage_log_error_class_len check (error_class is null or char_length(error_class) <= 40);

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 35 (0290)' as step, '0290 four database closures: a membership can no longer be handed to another person' as what, not ((not exists (select 1 from pg_trigger where tgname = 'group_memberships_guard_identity'))) as in_place
  union all
  select 'step 36 (0291)' as step, '0291 booking and credit closures: a booking' as what, not ((coalesce((select position('that coach does not coach this group' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace), false))) as in_place
  union all
  select 'step 37 (0292)' as step, '0292 the AI call log records why a call failed' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_log' and column_name = 'error_class'))) as in_place
) as result order by step;
