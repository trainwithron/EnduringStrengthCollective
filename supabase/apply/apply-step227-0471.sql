-- PASTE: step 227 (the food check-in: when a client stops logging food or runs well off target, a short check-in goes to them in their coach's name, and their answer comes back
-- to the coach). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.

begin;

-- Step 227 (Ron, Nov 24: "build it"): the food check-in. When a client stops logging food, or their logged calories run well off target, the coach's Nutrition Spotter sends the
-- CLIENT a short check-in in the coach's name ("Haven't seen your food in a few days. Everything OK with the plan?"), and the answer comes back to the coach. Re-running is safe.
--
-- * public.client_food_checkins: one row per check-in sent. The client reads their own; the group's coaches read the group's. Nobody signed in writes it directly: the daily job
--   sends (server key), and the client's answer, "Not now" and the coach's "Mark handled" go through the app's server routes, which check who is asking first.
-- * client_nutrition_flags.checkins_off: the coach's per-client "Food check-ins: Off" (a coach of the group sets it, the same rules as the table's other switch).
-- * Three notice types: food_checkin (to the client, in the coach's name), food_checkin_answered (to the coach) and food_checkin_sent (the coach's own "Sent <client> a food
--   check-in"). The type list is rebuilt the safe way (step 0294): every live type is kept, and the paste stops if the count is off.

create table if not exists public.client_food_checkins (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  -- the coach it is sent as (the client's main coach); kept when that coach's account goes
  coach_id uuid references public.profiles(id) on delete set null,
  -- 'quiet': nothing logged for 3 days; 'off': logged calories averaging more than 15% off target
  trigger text not null check (trigger in ('quiet', 'off')),
  -- for 'off': the average logged calories minus the target (negative = under), and the days logged of the last 7
  avg_diff_kcal integer check (avg_diff_kcal is null or avg_diff_kcal between -20000 and 20000),
  days_logged smallint check (days_logged is null or days_logged between 0 and 7),
  target_kcal integer check (target_kcal is null or target_kcal between 0 and 20000),
  sent_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent', 'answered', 'handled', 'expired')),
  -- the client's answer: the chips they ticked and their own words
  reasons text[] not null default '{}' check (reasons <@ array['long_cook', 'disliked_food', 'tracking_hassle', 'rework_plan', 'all_good']::text[] and cardinality(reasons) <= 5),
  note text check (note is null or char_length(note) <= 500),
  answered_at timestamptz,
  -- "Not now": hidden for that day of the client's calendar; it stays unanswered
  not_now_on date,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz
);
create index if not exists client_food_checkins_athlete_sent_idx on public.client_food_checkins (athlete_id, sent_at desc);
create index if not exists client_food_checkins_group_sent_idx on public.client_food_checkins (group_id, sent_at desc);

alter table public.client_food_checkins enable row level security;
revoke all on public.client_food_checkins from anon;
revoke insert, update, delete, truncate, references, trigger on public.client_food_checkins from authenticated;
grant select on public.client_food_checkins to authenticated;
grant all on public.client_food_checkins to service_role;

drop policy if exists "client_food_checkins_read" on public.client_food_checkins;
create policy "client_food_checkins_read" on public.client_food_checkins for select
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_food_checkins' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.client_food_checkins as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;

alter table public.client_nutrition_flags add column if not exists checkins_off boolean not null default false;

-- ---- the three notice types (the 0294 way) ----
do $types$
declare
  v_def text;
  v_new_def text;
  v_have text[];
  v_all text[];
  v_after integer;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  -- Every quoted value in the live list, whatever characters it has (a type with a digit or a capital is not dropped).
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['food_checkin', 'food_checkin_answered', 'food_checkin_sent']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  -- The rebuilt list must hold EVERY type the old one did, plus the new ones. If the count is off, stop and put everything back (the whole paste rolls back).
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

-- ---- the coach's two new notices follow the coach's "Client activity" switch (the bell is dropped by notifications_respect_switch, the push by lib/coach-notice.ts) ----
-- The live list (Nov 24) with the two new lines; the client's own check-in notice has no kind (a client always gets it).
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
    when 'exercise_swap' then 'client_activity'
    when 'food_checkin_answered' then 'client_activity'
    when 'food_checkin_sent' then 'client_activity'
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

commit;

-- Check: one row, all true.
select
  to_regclass('public.client_food_checkins') is not null as checkins_table,
  (select relrowsecurity from pg_class where oid = 'public.client_food_checkins'::regclass) as row_security_on,
  exists (select 1 from pg_policy where polrelid = 'public.client_food_checkins'::regclass and polname = 'client_food_checkins_read' and polcmd = 'r'
          and polroles @> array[(select oid from pg_roles where rolname = 'authenticated')]) as client_and_coaches_read,
  has_table_privilege('authenticated', 'public.client_food_checkins', 'select') as signed_in_has_select,
  not has_table_privilege('authenticated', 'public.client_food_checkins', 'insert') and not has_table_privilege('authenticated', 'public.client_food_checkins', 'update')
    and not has_table_privilege('authenticated', 'public.client_food_checkins', 'delete') as signed_in_cannot_write,
  not has_table_privilege('anon', 'public.client_food_checkins', 'select') as anon_cannot_read,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_nutrition_flags' and column_name = 'checkins_off') as per_client_switch,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass) like '%''food_checkin''%'
    and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass) like '%''food_checkin_answered''%'
    and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass) like '%''food_checkin_sent''%' as notice_types_added,
  (select count(*) from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass), '''([^'']+)''::text', 'g')) >= 51 as no_type_lost,
  public.notice_kind_of('food_checkin_answered') = 'client_activity' and public.notice_kind_of('food_checkin_sent') = 'client_activity' and public.notice_kind_of('food_checkin') is null
    and public.notice_kind_of('exercise_swap') = 'client_activity' as coach_switches_apply,
  md5(replace((select prosrc from pg_proc where oid = 'public.notice_kind_of(text)'::regprocedure), chr(13), '')) = 'ac455872a482589ed8461e2bf0af1431' as notice_kinds_as_written;
