-- PASTE: step 215 (weekly check-ins, the 90-day goal look, and scan counts for machine QR codes). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.

begin;

-- Step 215 (Ron, Nov 20: wave 2 approved). Three small additions; nothing existing is changed or removed.
--
-- 1. The weekly check-in (R2). One per client per space per week (the week starts on Monday in the client's time zone, else the coach's; the app works the date out). The client sends
--    two 1 to 5 answers (energy, eating), an optional win and hard thing, optional progress photos (their own progress_photos rows, shared with the coach), and a snapshot the app
--    fills in from their logs that week (workouts done of planned, average weight, days food was logged). The client can change it until a coach of the space marks it reviewed;
--    a coach of the space reads it and can only mark it reviewed (and link the reply they sent as a direct message). Nobody else reads or writes it, nobody deletes it.
--    weekly_checkins_guard (a trigger) holds the column rules row security cannot: the client never sets the review, a coach never changes what the client sent, the review time
--    and reviewer are the database's own, and a linked reply must be a message that coach sent this client in this space.
--    A new notice type, weekly_checkin (the coach is told a check-in came in), in the "Client activity" switch (notice_kind_of, as migration 0423 set it, plus this one type).
-- 2. The 90-day goal look (R5): client_goal_sheets.reviewed_at, stamped when the client says "Still my goal". Written only by the server, like the rest of that table.
-- 3. Scan counts for machine QR codes (M2): qr_scans, one row per scan of a machine's or an exercise's QR page: which code and when, nothing about who (no account, no address,
--    no device). Only the server writes it; a coach reads their own machines' counts through count_machine_scans.
-- Re-running is safe.

-- ---- 1a. the new notice type (the same widening as 0422: read the live list, add, check it matches) ---------------------------------------------------------------------
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['weekly_checkin']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

-- ---- 1b. which switch the new type belongs to: the list from 0423, with weekly_checkin under client activity ------------------------------------------------------------
create or replace function public.notice_kind_of(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'booking_request' then 'bookings'
    when 'late_change' then 'bookings'
    when 'waitlist_slot_offered' then 'bookings'
    when 'recurring_booking_conflict' then 'bookings'
    when 'schedule_request' then 'bookings'
    when 'schedule_applied' then 'bookings'
    when 'schedule_resumed' then 'bookings'
    when 'request_decision' then 'bookings'
    when 'trainer_dispatch_offer' then 'bookings'
    when 'trainer_dispatch_question' then 'bookings'
    when 'direct_message' then 'messages'
    when 'comment' then 'messages'
    when 'goal_proposed' then 'client_activity'
    when 'goal_answered' then 'client_activity'
    when 'meal_plan_try' then 'client_activity'
    when 'nutrition_allergies_updated' then 'client_activity'
    when 'nutrition_baseline_ready' then 'client_activity'
    when 'nutrition_preferences_changed' then 'client_activity'
    when 'nutrition_prompt_answered' then 'client_activity'
    when 'nutrition_target_changed' then 'client_activity'
    when 'weekly_checkin' then 'client_activity'
    when 'milestone_celebration' then 'milestones'
    when 'pr_promotion' then 'milestones'
    when 'client_request' then 'requests'
    when 'session_pattern_note' then 'session_notes'
    when 'payment_received' then 'payments'
    when 'payment_problem' then 'payments'
    when 'team_sheet_saved' then 'team'
    when 'org_announcement' then 'team'
    when 'gym_visitor_lead' then 'team'
    else null
  end
$$;
revoke all on function public.notice_kind_of(text) from public, anon;
grant execute on function public.notice_kind_of(text) to authenticated, service_role;

-- ---- 1c. the weekly check-in -------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.weekly_checkins (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  -- the coach it was sent to (the space's coach when it was sent); the space's coaches all read it
  coach_id uuid references public.profiles(id) on delete set null,
  -- the Monday the week starts on
  week_start date not null check (extract(isodow from week_start) = 1),
  energy smallint not null check (energy between 1 and 5),
  eating smallint not null check (eating between 1 and 5),
  win text check (win is null or char_length(win) <= 2000),
  hard text check (hard is null or char_length(hard) <= 2000),
  -- the client's own progress photos sent with it (progress_photos ids)
  photo_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(photo_ids) = 'array' and jsonb_array_length(photo_ids) <= 6),
  -- filled in from the client's logs: {workouts_done, workouts_planned, avg_weight, prev_avg_weight, weight_unit, food_days}
  auto_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(auto_snapshot) = 'object' and octet_length(auto_snapshot::text) <= 2000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reply_message_id uuid references public.direct_messages(id) on delete set null,
  unique (athlete_id, group_id, week_start)
);
create index if not exists weekly_checkins_to_review_idx on public.weekly_checkins (group_id, submitted_at desc) where reviewed_at is null;
create index if not exists weekly_checkins_week_idx on public.weekly_checkins (group_id, week_start);

alter table public.weekly_checkins enable row level security;
revoke all on public.weekly_checkins from anon, authenticated;
grant select, insert, update on public.weekly_checkins to authenticated;

drop policy if exists "weekly_checkins_read" on public.weekly_checkins;
create policy "weekly_checkins_read" on public.weekly_checkins for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

-- the client, for themselves, in a space where they are a client, never already reviewed
drop policy if exists "weekly_checkins_send_own" on public.weekly_checkins;
create policy "weekly_checkins_send_own" on public.weekly_checkins for insert to authenticated
  with check (
    athlete_id = (select auth.uid())
    and reviewed_at is null and reviewed_by is null and reply_message_id is null
    and exists (select 1 from public.group_memberships m where m.group_id = weekly_checkins.group_id and m.profile_id = (select auth.uid()) and m.role = 'athlete')
  );

-- the client changes their own only until it is reviewed
drop policy if exists "weekly_checkins_edit_own" on public.weekly_checkins;
create policy "weekly_checkins_edit_own" on public.weekly_checkins for update to authenticated
  using (athlete_id = (select auth.uid()) and reviewed_at is null)
  with check (athlete_id = (select auth.uid()) and reviewed_at is null);

-- a coach of the space marks it reviewed (the guard below keeps them to the review columns)
drop policy if exists "weekly_checkins_review" on public.weekly_checkins;
create policy "weekly_checkins_review" on public.weekly_checkins for update to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

-- like every table of group content, the organization wall when it is installed
do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null then
    drop policy if exists "org_wall_header" on public.weekly_checkins;
    create policy "org_wall_header" on public.weekly_checkins as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;

create or replace function public.weekly_checkins_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- the server (no one signed in) is not limited here
  if v_uid is null then
    return new;
  end if;
  if new.id is distinct from old.id or new.athlete_id is distinct from old.athlete_id or new.group_id is distinct from old.group_id or new.week_start is distinct from old.week_start then
    raise exception 'A check-in cannot be moved to another person, space or week.' using errcode = '42501';
  end if;
  if v_uid = old.athlete_id then
    -- the client: their own answers while it is not reviewed, never the review
    if old.reviewed_at is not null then
      raise exception 'Your coach already reviewed this check-in.' using errcode = '42501';
    end if;
    if new.reviewed_at is distinct from old.reviewed_at or new.reviewed_by is distinct from old.reviewed_by or new.reply_message_id is distinct from old.reply_message_id then
      raise exception 'Only a coach marks a check-in reviewed.' using errcode = '42501';
    end if;
    return new;
  end if;
  -- a coach: only the review
  if (new.coach_id, new.energy, new.eating, new.win, new.hard, new.photo_ids, new.auto_snapshot, new.submitted_at)
     is distinct from (old.coach_id, old.energy, old.eating, old.win, old.hard, old.photo_ids, old.auto_snapshot, old.submitted_at) then
    raise exception 'A coach cannot change what the client sent.' using errcode = '42501';
  end if;
  if new.reviewed_at is null then
    if old.reviewed_at is not null or new.reviewed_by is distinct from old.reviewed_by or new.reply_message_id is distinct from old.reply_message_id then
      raise exception 'A review is not taken back.' using errcode = '42501';
    end if;
    return new;
  end if;
  -- the time and who reviewed are the database's own, and the first review stands
  new.reviewed_at := coalesce(old.reviewed_at, now());
  new.reviewed_by := coalesce(old.reviewed_by, v_uid);
  if new.reply_message_id is distinct from old.reply_message_id then
    if old.reply_message_id is not null
       or not exists (select 1 from public.direct_messages d where d.id = new.reply_message_id and d.sender_id = v_uid and d.recipient_id = old.athlete_id and d.group_id = old.group_id) then
      raise exception 'The reply must be a message you sent this client here.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.weekly_checkins_guard() from public, anon, authenticated;

drop trigger if exists weekly_checkins_guard on public.weekly_checkins;
create trigger weekly_checkins_guard
  before update on public.weekly_checkins
  for each row execute function public.weekly_checkins_guard();

-- ---- 2. the 90-day goal look ---------------------------------------------------------------------------------------------------------------------------------------------
alter table public.client_goal_sheets add column if not exists reviewed_at timestamptz;

-- ---- 3. scan counts ------------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.qr_scans (
  id bigserial primary key,
  machine_id uuid references public.gym_machines(id) on delete cascade,
  exercise_id uuid references public.exercise_library(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  -- one code per scan: a machine's or an exercise's
  check ((machine_id is null) <> (exercise_id is null))
);
create index if not exists qr_scans_machine_idx on public.qr_scans (machine_id, scanned_at) where machine_id is not null;
create index if not exists qr_scans_exercise_idx on public.qr_scans (exercise_id, scanned_at) where exercise_id is not null;
alter table public.qr_scans enable row level security;
-- only the server writes or reads the rows
revoke all on public.qr_scans from anon, authenticated;
revoke all on sequence public.qr_scans_id_seq from anon, authenticated;

-- a coach's own machines: scans since the given moment (the start of the month in their time zone) and in all
create or replace function public.count_machine_scans(p_since timestamptz)
returns table (machine_id uuid, since_count bigint, total_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.id,
         count(s.id) filter (where s.scanned_at >= p_since),
         count(s.id)
  from public.gym_machines m
  left join public.qr_scans s on s.machine_id = m.id
  where m.created_by = (select auth.uid())
  group by m.id
$$;
revoke all on function public.count_machine_scans(timestamptz) from public, anon;
grant execute on function public.count_machine_scans(timestamptz) to authenticated;

commit;

-- check: one row, every column true
select
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass) like '%''weekly_checkin''%' as new_notice_type,
  public.notice_kind_of('weekly_checkin') = 'client_activity' and public.notice_kind_of('direct_message') = 'messages' and public.notice_kind_of('goal_answered') = 'client_activity' as notice_switch_knows_it,
  (select relrowsecurity from pg_class where oid = 'public.weekly_checkins'::regclass) as checkins_locked,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'weekly_checkins' and policyname in ('weekly_checkins_read', 'weekly_checkins_send_own', 'weekly_checkins_edit_own', 'weekly_checkins_review')) = 4 as checkin_rules,
  exists (select 1 from pg_trigger where tgname = 'weekly_checkins_guard' and tgrelid = 'public.weekly_checkins'::regclass) as checkin_guard,
  not has_table_privilege('authenticated', 'public.weekly_checkins', 'delete') and not has_table_privilege('anon', 'public.weekly_checkins', 'select') as nobody_deletes_or_peeks,
  exists (select 1 from pg_constraint where conrelid = 'public.weekly_checkins'::regclass and contype = 'u') as one_per_week,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_goal_sheets' and column_name = 'reviewed_at') as goal_review_column,
  (select relrowsecurity from pg_class where oid = 'public.qr_scans'::regclass)
    and not has_table_privilege('anon', 'public.qr_scans', 'insert') and not has_table_privilege('authenticated', 'public.qr_scans', 'select') as scans_server_only,
  has_function_privilege('authenticated', 'public.count_machine_scans(timestamptz)', 'execute') and not has_function_privilege('anon', 'public.count_machine_scans(timestamptz)', 'execute') as scan_counts_for_coaches;
