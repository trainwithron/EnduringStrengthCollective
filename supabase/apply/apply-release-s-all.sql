-- RELEASE S (BOOKING HOURS CHECK, GROUPED COUNTS, HIDE DEMOS PER PERSON, THE AWAY PRESET REPLY): ONE paste. Steps 57, 58, 59, 60 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 57: Nothing changes for normal use: the booking screens already only offer times inside the coach's hours. A direct call that tries to book or move a client's own session outside the coach's open hours, or onto time off, is now refused with 'that time is outside your coach's hours'. A coach scheduling a client is never refused.
-- AFTER STEP 58: Nothing visible changes: the same numbers appear on the Clients page, client profile and calendar. With the code of the same release live they are counted inside the database instead of by reading every open session, which is what keeps them working for a gym with hundreds of clients.
-- AFTER STEP 59: Nothing changes until the code of the same release is live. After that a client who turns off exercise demos in Settings has them off on every phone and computer they sign in on; a client who never touched it sees demos as before.
-- AFTER STEP 60: Nothing changes until a coach turns it on in Messages. While it is on, each message a client sends gets the coach's reply (no limit: every message gets it), the coach still gets the usual notice for the client's message, and the thread shows a small 'Auto-reply' note on each reply that went out. It stops after the last day if one was set, or when the coach turns it off.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release S (booking hours check, grouped counts, hide demos per person, the away preset reply), step 57: 0312 A client booking or moving their own session must stay inside the coach's open hours and clear of time off: book_session and reschedule_booking now refuse any other time (a coach booking for a client is never refused)
do $g57$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('coach_time_is_open exists (0279 is applied)', exists (select 1 from pg_proc where proname = 'coach_time_is_open' and pronamespace = 'public'::regnamespace)),
      ('0291 is applied (book_session checks that the coach coaches the group)', coalesce((select position('that coach does not coach this group' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false)),
      ('0312 is not already applied (book_session does not check the hours yet)', coalesce((select position('coach_time_is_open' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release S (booking hours check, grouped counts, hide demos per person, the away preset reply), step 57 (0312) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g57$;

-- ====================================================================================================
-- migration 0312_booking_hours_server_check.sql
-- ====================================================================================================

-- Release S, part 1: a client booking or moving their own session must stay inside the coach's open hours (Ron: needed before outside coaches arrive, mid-November).
--
-- Until now book_session and reschedule_booking checked the notice period, credits and overlap (with the coach's buffer) but NOT the coach's weekly hours or time off: only the
-- request functions did, through coach_time_is_open (0279). The client screens never offer an off-hours time, but a direct call to the database could still book one. Now:
--   * book_session: a client booking for themselves is refused, "that time is outside your coach's hours", unless the whole session sits inside one open window and clear of time off.
--   * reschedule_booking: the same for the new time when a client moves their own session (a coach who is their own client is not refused; a coach moves a client's session another way).
--   * A coach booking a client's session (and a coach who is their own client) is never refused; the server's own routines are never refused. A weekly schedule
--     a client starts books each week through book_session, so a week outside the hours is reported as not booked, like any other refused week.
-- Both functions are the LIVE text (identical to 0291, checked by comparing the bodies) with only the check above added. Their rights are unchanged (signed-in users and the
-- server may run them; the public may not), and the migration stops if they ever are not. Needs 0279 (coach_time_is_open) and 0291. Re-runnable.

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

  -- A client booking for themselves must book inside the coach's open hours and clear of time off. The screens only offer such times; this makes the server refuse any other, so a
  -- direct call cannot book outside them. A coach booking for a client, a coach who is their own client, and the server's own routines are never refused: for them an
  -- off-hours time is a warning on the screen, not a block.
  if v_is_self and not coalesce(public.is_group_coach(p_group_id), false) and not public.coach_time_is_open(p_coach_id, p_start_at, p_end_at) then
    raise exception 'that time is outside your coach''s hours';
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

  -- The new time must also be inside the coach's open hours and clear of time off, for a client moving their own session (only the client can run this function; a coach who is their own client is not refused).
  if not coalesce(public.is_group_coach(v_group_id), false) and not public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at) then
    raise exception 'that time is outside your coach''s hours';
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

-- The rights must be exactly what they were: signed-in users and the server, not the public or signed-out visitors.
do $acl$
begin
  if not has_function_privilege('authenticated', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.reschedule_booking(uuid, timestamptz, timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.reschedule_booking(uuid, timestamptz, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.reschedule_booking(uuid, timestamptz, timestamptz)', 'execute') then
    raise exception 'The rights on book_session or reschedule_booking are not what they were. NOTHING was changed by this migration.';
  end if;
end
$acl$;

-- ===== Release S (booking hours check, grouped counts, hide demos per person, the away preset reply), step 58: 0313 Session counts worked out in the database for large rosters: one function (booking_counts) returns booked, to mark and prepaid-ahead per client and group, with a small index, so the pages that show "8 left · 4 booked · 2 to mark" stay fast and complete with 500+ clients
do $g58$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('bookings exists', to_regclass('public.bookings') is not null),
      ('0313 is not already applied (booking_counts is not there yet)', not exists (select 1 from pg_proc where proname = 'booking_counts' and pronamespace = 'public'::regnamespace))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release S (booking hours check, grouped counts, hide demos per person, the away preset reply), step 58 (0313) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g58$;

-- ====================================================================================================
-- migration 0313_booking_counts_function.sql
-- ====================================================================================================

-- Release S, part 2: the session counts for large rosters (Ron: needed before the December gym pilot, 500+ clients).
--
-- Every place that shows "8 left · 4 booked · 2 to mark" used to read EVERY open confirmed session a page at a time (1000 rows per request) and count them in the app: fine to about
-- 150 clients, slow past 300, and past about 400 the read ran out of pages and the counts were left off. This adds ONE function that returns the counts per client and group,
-- worked out inside the database:
--   booked         a confirmed session that has not ended and has not taken its session yet (unsettled)
--   to_mark        a confirmed session that has ended, is unsettled, not marked attended and not a no-show
--   prepaid_ahead  a confirmed session that has not ended and was prepaid when booked
-- The same rules the app used (lib/credit-picture.ts countBookings) for one-on-one sessions, and, new, the group classes a client is in (they were charged through their own table and
-- never counted): a class the client joined themselves already took a session when they joined, so a coming one reads as prepaid ahead (like a prepaid booking) and a finished one
-- is done; a class the coach added them to is charged when marked attended, so a coming one reads as booked and a finished, unmarked one as to mark (like an unsettled booking).
-- Cancelled classes, waiting-list places and cancelled places are not counted. It is NOT a security-definer function: it runs as the caller, so the
-- existing row security on bookings decides what is counted (a coach sees their own bookings, a client only theirs, the server everything). Filters are optional: one coach, one
-- client, a list of clients, one group. Rows come back in a fixed order so the app can read them a page at a time if there are ever more than 1000 clients with open sessions.
-- A partial index keeps the read short. New objects only (no existing function or table changes). Re-runnable.

create index if not exists bookings_open_counts_idx
  on public.bookings (coach_id, athlete_id, group_id)
  where status = 'confirmed' and credit_state in ('unsettled', 'prepaid');

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

revoke all on function public.booking_counts(uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function public.booking_counts(uuid, uuid, uuid[], uuid) to authenticated, service_role;

-- ===== Release S (booking hours check, grouped counts, hide demos per person, the away preset reply), step 59: 0314 "Hide exercise demos" follows the person, not the device: one tiny private table (client_ui_settings, one row per client, only that client can read or change it)
do $g59$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('profiles exists', to_regclass('public.profiles') is not null),
      ('0314 is not already applied (client_ui_settings is not there yet)', to_regclass('public.client_ui_settings') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release S (booking hours check, grouped counts, hide demos per person, the away preset reply), step 59 (0314) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g59$;

-- ====================================================================================================
-- migration 0314_client_ui_settings.sql
-- ====================================================================================================

-- Release S, part 4: "Hide exercise demos" follows the PERSON, not the device (Ron: a client who turns demos off should not have to do it again on every phone and computer).
--
-- Until now the choice lived only in the browser. This adds one tiny private table, one row per client, holding that switch (and room for other personal display switches later):
--   * client_ui_settings(athlete_id, hide_demos, updated_at): readable and writable ONLY by that client (not their coach, not anyone else), exactly like read_settings (0298).
--     It is deliberately NOT a column on read_settings: a row there means "this client made a reading choice", and a coach's own default for the reading would be overridden
--     the moment a row existed for some other reason.
--   * Nothing is deleted or changed in any existing table. A client who has not used the switch has no row and sees demos as before. The app keeps the old on-this-device value
--     until the person next flips the switch (then it is saved here too), so nobody loses their current choice. Removing the account removes the row with it.
-- New object only. Re-runnable.

create table if not exists public.client_ui_settings (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  hide_demos boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.client_ui_settings enable row level security;
drop policy if exists "client_ui_settings_select_own" on public.client_ui_settings;
create policy "client_ui_settings_select_own" on public.client_ui_settings for select to authenticated using (athlete_id = (select auth.uid()));
drop policy if exists "client_ui_settings_insert_own" on public.client_ui_settings;
create policy "client_ui_settings_insert_own" on public.client_ui_settings for insert to authenticated with check (athlete_id = (select auth.uid()));
drop policy if exists "client_ui_settings_update_own" on public.client_ui_settings;
create policy "client_ui_settings_update_own" on public.client_ui_settings for update to authenticated
  using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
drop policy if exists "client_ui_settings_delete_own" on public.client_ui_settings;
create policy "client_ui_settings_delete_own" on public.client_ui_settings for delete to authenticated using (athlete_id = (select auth.uid()));
revoke all on public.client_ui_settings from anon;
-- Row policies do not govern TRUNCATE, REFERENCES or TRIGGER; no client path needs them.
revoke truncate, references, trigger on public.client_ui_settings from authenticated;

-- ===== Release S (booking hours check, grouped counts, hide demos per person, the away preset reply), step 60: 0315 The "I'm away" preset reply: a coach writes one reply, turns it on (optionally with a last day), and every message a client sends them gets that reply back in the thread (marked as an auto-reply). One tiny private table, one marker column, two trigger functions
do $g60$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('direct_messages exists (0140 is applied)', to_regclass('public.direct_messages') is not null),
      ('0315 is not already applied (coach_away_replies is not there yet)', to_regclass('public.coach_away_replies') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release S (booking hours check, grouped counts, hide demos per person, the away preset reply), step 60 (0315) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g60$;

-- ====================================================================================================
-- migration 0315_away_reply.sql
-- ====================================================================================================

-- Release S, part 5: the "I'm away" preset reply (Ron, Oct 8: "a preset reply, not an automatic text").
--
-- The coach writes ONE reply, turns "I'm away" on (optionally with the last day), and while it is on every message a client sends them gets that reply back in the same thread.
--   * coach_away_replies(coach_id, enabled, message, ends_on, updated_at): one row per coach, readable and writable only by that coach.
--   * direct_messages.auto_reply: marks a message the database wrote from the preset (the thread shows it with a small "Auto-reply" note, so the coach can see which went out).
--     A person cannot mark their own message as an auto-reply, and cannot change the mark afterwards: only the function below can set it.
--   * send_away_reply(): after a CLIENT's message to their coach is added, writes the preset reply from the coach to that client, in the same group. It never reads the message.
--     It does nothing when: the new message is itself an auto-reply (no loops), the sender is a coach, the recipient is not a coach of the group, the coach has it off or no
--     reply text, the last day has passed (in the coach's time zone, New York when none is set), or
--     the new message is from a coach. Every other message gets the reply: there is no limit and no waiting time (Ron: every message while away is on gets it).
--   * The coach still gets the usual notice for the client's message (nothing about that changes), and the client gets the usual notice for the reply.
-- If writing the reply ever fails, the client's own message is still stored (the failure is only a warning). New table, one new column, two functions (both closed to signed-in
-- users: they only ever run as triggers). Re-runnable.

create table if not exists public.coach_away_replies (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  message text not null default '' check (char_length(message) <= 1000),
  ends_on date,
  updated_at timestamptz not null default now()
);
alter table public.coach_away_replies enable row level security;
drop policy if exists "coach_away_replies_select_own" on public.coach_away_replies;
create policy "coach_away_replies_select_own" on public.coach_away_replies for select to authenticated using (coach_id = (select auth.uid()));
drop policy if exists "coach_away_replies_insert_own" on public.coach_away_replies;
create policy "coach_away_replies_insert_own" on public.coach_away_replies for insert to authenticated with check (coach_id = (select auth.uid()));
drop policy if exists "coach_away_replies_update_own" on public.coach_away_replies;
create policy "coach_away_replies_update_own" on public.coach_away_replies for update to authenticated
  using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
drop policy if exists "coach_away_replies_delete_own" on public.coach_away_replies;
create policy "coach_away_replies_delete_own" on public.coach_away_replies for delete to authenticated using (coach_id = (select auth.uid()));
revoke all on public.coach_away_replies from anon;
revoke truncate, references, trigger on public.coach_away_replies from authenticated;

alter table public.direct_messages add column if not exists auto_reply boolean not null default false;

-- Only send_away_reply() can set the mark (it flags the transaction first); anything a person sends or edits keeps it off / as it was.
create or replace function public.guard_direct_message_auto_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if coalesce(current_setting('app.away_reply', true), '') <> '1' then
        new.auto_reply := false;
      end if;
    else
      new.auto_reply := old.auto_reply;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists direct_messages_guard_auto_reply on public.direct_messages;
create trigger direct_messages_guard_auto_reply
  before insert or update on public.direct_messages
  for each row execute function public.guard_direct_message_auto_reply();

create or replace function public.send_away_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.coach_away_replies%rowtype;
  v_tz text;
begin
  if new.auto_reply then
    return new;
  end if;
  -- Only a client writing to their coach.
  if not exists (select 1 from public.group_memberships gm where gm.group_id = new.group_id and gm.profile_id = new.recipient_id and gm.role = 'coach') then
    return new;
  end if;
  if exists (select 1 from public.group_memberships gm where gm.group_id = new.group_id and gm.profile_id = new.sender_id and gm.role = 'coach') then
    return new;
  end if;

  select * into v_cfg from public.coach_away_replies where coach_id = new.recipient_id and enabled;
  if not found or btrim(v_cfg.message) = '' then
    return new;
  end if;

  if v_cfg.ends_on is not null then
    select timezone into v_tz from public.profiles where id = new.recipient_id;
    if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
      v_tz := 'America/New_York';
    end if;
    if (now() at time zone v_tz)::date > v_cfg.ends_on then
      return new;
    end if;
  end if;

  perform set_config('app.away_reply', '1', true);
  -- created_at is the clock, not the start of the transaction, so the reply always sorts after the message it answers (both would otherwise carry the same time).
  begin
    insert into public.direct_messages (group_id, sender_id, recipient_id, body, auto_reply, created_at)
    values (new.group_id, new.recipient_id, new.sender_id, v_cfg.message, true, clock_timestamp());
  exception when others then
    raise warning 'away reply not sent: %', sqlerrm;
  end;
  perform set_config('app.away_reply', '', true);
  return new;
end;
$$;

drop trigger if exists direct_messages_send_away_reply on public.direct_messages;
create trigger direct_messages_send_away_reply
  after insert on public.direct_messages
  for each row execute function public.send_away_reply();

revoke all on function public.guard_direct_message_auto_reply() from public, anon, authenticated;
revoke all on function public.send_away_reply() from public, anon, authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 57 (0312)' as step, '0312 A client booking or moving their own session must stay inside the coach''s open hours and clear of time off: book_session and reschedule_booking now refuse any other time' as what, not ((coalesce((select position('coach_time_is_open' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false))) as in_place
  union all
  select 'step 58 (0313)' as step, '0313 Session counts worked out in the database for large rosters: one function' as what, not ((not exists (select 1 from pg_proc where proname = 'booking_counts' and pronamespace = 'public'::regnamespace))) as in_place
  union all
  select 'step 59 (0314)' as step, '0314 "Hide exercise demos" follows the person' as what, not ((to_regclass('public.client_ui_settings') is null)) as in_place
  union all
  select 'step 60 (0315)' as step, '0315 The "I''m away" preset reply: a coach writes one reply' as what, not ((to_regclass('public.coach_away_replies') is null)) as in_place
) as result order by step;
