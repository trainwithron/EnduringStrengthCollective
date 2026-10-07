-- RELEASE J (ABOUT YOU, BASELINE, PHASE OF RECORD): ONE paste. Steps 40 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 40: Nothing changes for anyone until the code in the same release is live. After that: a client fills in 'About you' (height, sex, activity, units) and a new client gets a starting target the coach reviews; a coach sees and edits the phase a client is in, with a review date and a planned next phase the client never sees; a goal a coach proposes can carry a phase, and the client confirming it moves the phase. Existing clients are given a phase of record from their latest check-in (or their milestone tag). One existing function is rebuilt (guard_client_goal_update: a client's counter-proposal now clears a proposed phase; its permissions are untouched). Run it together with the release's code deploy.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release J (about you, baseline, phase of record), step 40: 0295 about you, a starting target for a new client, and the phase a client is in: activity level and units on the client's own details (a coach writes the calculator inputs only through one function), a baseline kind of check-in suggestion with a fixed-wording notice to the coaches, the phase of record (coach-only, filled in from existing check-ins and milestone tags), and a coach-proposed goal that can carry a phase which becomes the phase of record only when the client confirms it, plus one new notification type added to the list the database already has
do $g40$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('athlete_profile_details, nutrition_checkins, nutrition_checkin_suggestions, client_goals, nutrition_phases and notifications exist', to_regclass('public.athlete_profile_details') is not null and to_regclass('public.nutrition_checkins') is not null and to_regclass('public.nutrition_checkin_suggestions') is not null and to_regclass('public.client_goals') is not null and to_regclass('public.nutrition_phases') is not null and to_regclass('public.notifications') is not null),
      ('is_group_coach exists and guard_client_goal_update exists (0284 is applied)', exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace) and to_regprocedure('public.guard_client_goal_update()') is not null),
      ('the notification types list exists and can be read (notifications_type_check)', exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)),
      ('0295 is not already applied (client_phase_plans is not there yet)', to_regclass('public.client_phase_plans') is null),
      ('0295 is not already applied (athlete_profile_details has no activity_level yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_profile_details' and column_name = 'activity_level')),
      ('0295 is not already applied (client_goals has no nutrition_phase yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_goals' and column_name = 'nutrition_phase'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release J (about you, baseline, phase of record), step 40 (0295) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g40$;

-- ====================================================================================================
-- migration 0295_about_you_baseline_phase_of_record.sql
-- ====================================================================================================

-- Nutrition Phase 2: "About you" inputs, a starting (baseline) target for a new client, and the phase a client is actually in.
--
--  * athlete_profile_details gets activity_level, weight_unit and portion_units. The client keeps writing their own row (the existing own-row policies). A COACH writes
--    the calculator's inputs through coach_set_body_profile (SECURITY DEFINER, the caller must coach THAT group and the person must be a client in it, ranges checked,
--    only these columns written), never through a widened table policy, so a coach still cannot touch a client's bio or phone.
--  * Baseline storage: nutrition_checkin_suggestions and nutrition_checkins get a kind ('weekly' | 'baseline'). A brand-new client has no previous weight, previous
--    calories, adherence or recovery rating, so those columns may be empty for a BASELINE only; a weekly row must still carry all of them (a new check). The
--    suggestions table also records whether the suggested number is under the soft calorie floor.
--  * client_phase_plans: the phase of record (engine vocabulary), when it started, an optional review date and an optional planned next phase. Coach-only (a client has
--    no policy). Existing clients are backfilled: the latest check-in's phase (started where its current unbroken run began), else the milestone tag mapped
--    (cut -> fat_loss, bulk -> hypertrophy, reverse_diet -> reverse_diet), else none.
--  * client_goals.nutrition_phase: a coach-proposed goal can carry the phase it proposes ("Rebuild: reverse diet" is a custom goal with a phase). Three guards make it
--    trustworthy: (a) a client's own goal can never carry one (insert trigger); (b) a client's counter-proposal or change clears it (guard_client_goal_update, rebuilt
--    with CREATE OR REPLACE from the LIVE text: same signature, SECURITY DEFINER and search path, so its permissions are untouched); (c) the phase of record follows a
--    goal ONLY when a coach proposed it and the CLIENT confirmed it (an AFTER UPDATE trigger, the only writer on that path; it also writes the milestone tag).
--  * A baseline suggestion tells the group's coaches with fixed wording ("A starting target is ready for Sam").
--  * Notification types: one new type added to the list the database ALREADY has (read at apply time, never typed from an older migration).
-- No existing function is dropped. Re-runnable.

-- ---- About you ----
alter table public.athlete_profile_details
  add column if not exists activity_level text,
  add column if not exists weight_unit text not null default 'lb',
  add column if not exists portion_units text not null default 'grams';

alter table public.athlete_profile_details drop constraint if exists athlete_profile_details_activity_level_ok;
alter table public.athlete_profile_details add constraint athlete_profile_details_activity_level_ok
  check (activity_level is null or activity_level in ('sedentary', 'light', 'moderate', 'very_active'));
alter table public.athlete_profile_details drop constraint if exists athlete_profile_details_weight_unit_ok;
alter table public.athlete_profile_details add constraint athlete_profile_details_weight_unit_ok check (weight_unit in ('lb', 'kg'));
alter table public.athlete_profile_details drop constraint if exists athlete_profile_details_portion_units_ok;
alter table public.athlete_profile_details add constraint athlete_profile_details_portion_units_ok check (portion_units in ('household', 'grams'));

create or replace function public.coach_set_body_profile(
  p_athlete uuid,
  p_group uuid,
  p_height_cm numeric default null,
  p_sex text default null,
  p_body_fat_pct numeric default null,
  p_activity text default null,
  p_weight_unit text default null,
  p_portion_units text default null,
  p_clear_body_fat boolean default false
)
returns public.athlete_profile_details
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.athlete_profile_details;
begin
  if auth.uid() is null or not coalesce(public.is_group_coach(p_group), false) then
    raise exception 'Only a coach of this group can change a client''s body profile.';
  end if;
  if not exists (select 1 from public.group_memberships gm where gm.group_id = p_group and gm.profile_id = p_athlete and gm.role = 'athlete') then
    raise exception 'That person is not a client in this group.';
  end if;
  if p_height_cm is not null and (p_height_cm < 90 or p_height_cm > 250) then
    raise exception 'Height must be between 90 and 250 cm.';
  end if;
  if p_body_fat_pct is not null and (p_body_fat_pct < 3 or p_body_fat_pct > 60) then
    raise exception 'Body fat must be between 3 and 60 percent.';
  end if;
  if p_sex is not null and p_sex not in ('male', 'female') then
    raise exception 'Sex must be male or female.';
  end if;
  if p_activity is not null and p_activity not in ('sedentary', 'light', 'moderate', 'very_active') then
    raise exception 'Activity must be sedentary, light, moderate or very active.';
  end if;
  if p_weight_unit is not null and p_weight_unit not in ('lb', 'kg') then
    raise exception 'Weight unit must be lb or kg.';
  end if;
  if p_portion_units is not null and p_portion_units not in ('household', 'grams') then
    raise exception 'Portion units must be household or grams.';
  end if;

  insert into public.athlete_profile_details (athlete_id, height_cm, biological_sex, body_fat_pct, activity_level, weight_unit, portion_units, updated_at)
  values (p_athlete, p_height_cm, p_sex, case when p_clear_body_fat then null else p_body_fat_pct end, p_activity, coalesce(p_weight_unit, 'lb'), coalesce(p_portion_units, 'grams'), now())
  on conflict (athlete_id) do update set
    height_cm = coalesce(p_height_cm, public.athlete_profile_details.height_cm),
    biological_sex = coalesce(p_sex, public.athlete_profile_details.biological_sex),
    body_fat_pct = case when p_clear_body_fat then null else coalesce(p_body_fat_pct, public.athlete_profile_details.body_fat_pct) end,
    activity_level = coalesce(p_activity, public.athlete_profile_details.activity_level),
    weight_unit = coalesce(p_weight_unit, public.athlete_profile_details.weight_unit),
    portion_units = coalesce(p_portion_units, public.athlete_profile_details.portion_units),
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.coach_set_body_profile(uuid, uuid, numeric, text, numeric, text, text, text, boolean) from public, anon;
grant execute on function public.coach_set_body_profile(uuid, uuid, numeric, text, numeric, text, text, text, boolean) to authenticated, service_role;

-- ---- baseline storage ----
alter table public.nutrition_checkin_suggestions add column if not exists kind text not null default 'weekly';
alter table public.nutrition_checkins add column if not exists kind text not null default 'weekly';
alter table public.nutrition_checkin_suggestions add column if not exists below_floor boolean not null default false;

alter table public.nutrition_checkin_suggestions drop constraint if exists nutrition_checkin_suggestions_kind_ok;
alter table public.nutrition_checkin_suggestions add constraint nutrition_checkin_suggestions_kind_ok check (kind in ('weekly', 'baseline'));
alter table public.nutrition_checkins drop constraint if exists nutrition_checkins_kind_ok;
alter table public.nutrition_checkins add constraint nutrition_checkins_kind_ok check (kind in ('weekly', 'baseline'));

-- A baseline has no previous week to compare with, so these may be empty for it. The existing range checks already let an empty value through; the check below
-- makes sure a WEEKLY row still has every one of them.
alter table public.nutrition_checkin_suggestions
  alter column prev_weight_lbs drop not null,
  alter column curr_weight_lbs drop not null,
  alter column current_calories drop not null,
  alter column adherence_days drop not null,
  alter column recovery_rating drop not null,
  alter column adjustment_pct drop not null;
alter table public.nutrition_checkins
  alter column prev_weight_lbs drop not null,
  alter column curr_weight_lbs drop not null,
  alter column current_calories drop not null,
  alter column adherence_days drop not null,
  alter column recovery_rating drop not null,
  alter column adjustment_pct drop not null;

alter table public.nutrition_checkin_suggestions drop constraint if exists nutrition_checkin_suggestions_weekly_complete;
alter table public.nutrition_checkin_suggestions add constraint nutrition_checkin_suggestions_weekly_complete
  check (kind = 'baseline' or (prev_weight_lbs is not null and curr_weight_lbs is not null and current_calories is not null and adherence_days is not null and recovery_rating is not null and adjustment_pct is not null));
alter table public.nutrition_checkins drop constraint if exists nutrition_checkins_weekly_complete;
alter table public.nutrition_checkins add constraint nutrition_checkins_weekly_complete
  check (kind = 'baseline' or (prev_weight_lbs is not null and curr_weight_lbs is not null and current_calories is not null and adherence_days is not null and recovery_rating is not null and adjustment_pct is not null));

-- ---- the phase of record ----
create table if not exists public.client_phase_plans (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  phase text not null,
  started_on date not null default current_date,
  review_on date,
  planned_next_phase text,
  last_reviewed_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, group_id),
  constraint client_phase_plans_phase_ok check (phase in ('fat_loss', 'hypertrophy', 'maintenance', 'reverse_diet')),
  constraint client_phase_plans_next_ok check (planned_next_phase is null or planned_next_phase in ('fat_loss', 'hypertrophy', 'maintenance', 'reverse_diet'))
);

alter table public.client_phase_plans enable row level security;

drop policy if exists "client_phase_plans_coach_manage" on public.client_phase_plans;
create policy "client_phase_plans_coach_manage" on public.client_phase_plans for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (
    public.is_group_coach(group_id)
    and exists (select 1 from public.group_memberships gm where gm.group_id = client_phase_plans.group_id and gm.profile_id = client_phase_plans.athlete_id and gm.role = 'athlete')
  );
-- The client has no policy: the plan, including a planned next phase, is the coach's private plan.

-- One-time backfill for clients who already have check-ins: the latest check-in's phase, started where its current unbroken run began.
with ordered as (
  select athlete_id, group_id, phase, created_at,
         lag(phase) over (partition by athlete_id, group_id order by created_at) as prev_phase
  from public.nutrition_checkins
),
run_starts as (
  select athlete_id, group_id, phase, created_at from ordered where prev_phase is distinct from phase
),
latest as (
  select distinct on (athlete_id, group_id) athlete_id, group_id, phase
  from public.nutrition_checkins
  order by athlete_id, group_id, created_at desc
)
insert into public.client_phase_plans (athlete_id, group_id, phase, started_on)
select l.athlete_id, l.group_id, l.phase,
       coalesce((select max(s.created_at)::date from run_starts s where s.athlete_id = l.athlete_id and s.group_id = l.group_id and s.phase = l.phase), current_date)
from latest l
where exists (select 1 from public.group_memberships gm where gm.group_id = l.group_id and gm.profile_id = l.athlete_id and gm.role = 'athlete')
on conflict (athlete_id, group_id) do nothing;

-- Clients with a milestone tag but no check-in yet: the tag, mapped into the engine's words.
insert into public.client_phase_plans (athlete_id, group_id, phase, started_on)
select np.athlete_id, np.group_id,
       case np.phase when 'cut' then 'fat_loss' when 'bulk' then 'hypertrophy' when 'reverse_diet' then 'reverse_diet' end,
       np.started_at
from public.nutrition_phases np
where np.phase in ('cut', 'bulk', 'reverse_diet')
  and exists (select 1 from public.group_memberships gm where gm.group_id = np.group_id and gm.profile_id = np.athlete_id and gm.role = 'athlete')
on conflict (athlete_id, group_id) do nothing;

-- ---- the goal can carry a proposed phase, and only a coach's goal confirmed by the client can move the phase of record ----
alter table public.client_goals add column if not exists nutrition_phase text;
alter table public.client_goals drop constraint if exists client_goals_nutrition_phase_ok;
alter table public.client_goals add constraint client_goals_nutrition_phase_ok
  check (nutrition_phase is null or nutrition_phase in ('fat_loss', 'hypertrophy', 'maintenance', 'reverse_diet'));

-- (a) A client's own goal never carries a phase.
create or replace function public.clear_client_goal_phase_on_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and not coalesce(public.is_group_coach(new.group_id), false) then
    new.nutrition_phase := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists client_goals_clear_phase_on_insert on public.client_goals;
create trigger client_goals_clear_phase_on_insert
  before insert on public.client_goals
  for each row execute function public.clear_client_goal_phase_on_insert();

-- (b) guard_client_goal_update, from the live text, with ONE addition: a client's counter-proposal clears the phase.
create or replace function public.guard_client_goal_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ignore text[] := array['status', 'created_by', 'confirmed_at', 'confirmed_by'];
  -- What the two sides agree on. A coach's own tags on a confirmed goal (a note, the main lift, the weight class flag) are not part of the agreement.
  v_tags text[] := array['status', 'created_by', 'confirmed_at', 'confirmed_by', 'priority_note', 'main_lift_movement_pattern_id', 'weight_class_flag'];
  v_changed boolean;
  v_agreed_changed boolean;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Never movable by an end user.
  new.athlete_id := old.athlete_id;
  new.group_id := old.group_id;
  new.created_at := old.created_at;
  v_changed := (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore);
  v_agreed_changed := (to_jsonb(new) - v_tags) is distinct from (to_jsonb(old) - v_tags);

  if v_uid = old.athlete_id and not coalesce(public.is_group_coach(old.group_id), false) then
    -- The client answering a goal that is waiting on them.
    if old.status <> 'proposed' or old.created_by = v_uid then
      raise exception 'That goal is not waiting on you.';
    end if;
    if v_changed then
      -- A counter-proposal: the client is now the author, so it goes back to the coach. A client's goal never carries a phase.
      new.status := 'proposed';
      new.created_by := v_uid;
      new.confirmed_at := null;
      new.confirmed_by := null;
      new.nutrition_phase := null;
      return new;
    end if;
    if new.status = 'confirmed' then
      new.created_by := old.created_by;
      new.confirmed_at := now();
      new.confirmed_by := v_uid;
      return new;
    end if;
    if new.status = 'declined' then
      new.created_by := old.created_by;
      new.confirmed_at := null;
      new.confirmed_by := null;
      return new;
    end if;
    raise exception 'Confirm, change or decline the goal.';
  end if;

  if coalesce(public.is_group_coach(old.group_id), false) then
    -- Who authored a goal and who confirmed it are never taken from what a coach sends: only the two intended moves below change them.
    new.created_by := old.created_by;
    new.confirmed_at := old.confirmed_at;
    new.confirmed_by := old.confirmed_by;
    -- A goal a coach suggested is confirmed only by the client, whatever state it is in (including after the client declined it).
    if old.created_by <> old.athlete_id and new.status = 'confirmed' and old.status is distinct from 'confirmed' then
      raise exception 'Only the client can confirm a goal their coach suggested.';
    end if;
    if (old.status = 'proposed' and v_changed) or (old.status = 'confirmed' and new.status = 'confirmed' and v_agreed_changed) then
      -- Changing a goal that is still being agreed, or the date or type of one the client already confirmed, makes the coach its author, so it goes
      -- (back) to the client to agree to. A note, the main lift or the weight class flag on a confirmed goal stay the coach's to set.
      new.status := 'proposed';
      new.created_by := v_uid;
      new.confirmed_at := null;
      new.confirmed_by := null;
      return new;
    end if;
    if new.status is distinct from 'confirmed' then
      new.confirmed_at := null;
      new.confirmed_by := null;
    end if;
    if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
      new.confirmed_at := now();
      new.confirmed_by := v_uid;
    end if;
  end if;
  return new;
end;
$function$;

-- (c) The phase of record follows a goal ONLY when a coach proposed it and the client confirmed it. This trigger is the only writer on that path (the client has no policy
-- on the plan, and a coach's own edit of a goal goes back to the client to agree to).
create or replace function public.phase_follows_confirmed_goal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.created_by <> new.athlete_id and new.nutrition_phase is not null then
    insert into public.client_phase_plans (athlete_id, group_id, phase, started_on, review_on, updated_by, updated_at)
    values (new.athlete_id, new.group_id, new.nutrition_phase, current_date, null, new.created_by, now())
    on conflict (athlete_id, group_id) do update set
      phase = excluded.phase,
      started_on = excluded.started_on,
      review_on = null,
      updated_by = excluded.updated_by,
      updated_at = now();
    -- The milestone tag the trend detectors read, through the same mapping the coach's own phase control uses. Maintenance clears the tag.
    if new.nutrition_phase = 'maintenance' then
      delete from public.nutrition_phases where athlete_id = new.athlete_id and group_id = new.group_id;
    else
      insert into public.nutrition_phases (athlete_id, group_id, phase, started_at, created_by)
      values (new.athlete_id, new.group_id, case new.nutrition_phase when 'fat_loss' then 'cut' when 'hypertrophy' then 'bulk' else 'reverse_diet' end, current_date, new.created_by)
      on conflict (athlete_id, group_id) do update set phase = excluded.phase, started_at = excluded.started_at, updated_at = now();
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists client_goals_phase_follows_confirm on public.client_goals;
create trigger client_goals_phase_follows_confirm
  after update on public.client_goals
  for each row execute function public.phase_follows_confirmed_goal();

-- ---- notification types: the live list plus one ----
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
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
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['nutrition_baseline_ready']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  -- The rebuilt list must hold EVERY type the old one did, plus the new one. If not, everything rolls back.
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

-- ---- a starting target is ready (fixed wording, never the numbers) ----
create or replace function public.notify_on_nutrition_baseline()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  v_existing uuid;
  c record;
begin
  if new.kind <> 'baseline' then
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'your client') into v_name from public.profiles where id = new.athlete_id;
  for c in select profile_id from public.group_memberships where group_id = new.group_id and role = 'coach' loop
    -- ONE notice per coach and group while it is unread: a team coach whose athletes fill in About you over a week gets one line, not one per athlete. The first notice
    -- names the client; a second one folds into it ("several clients", linking to the Nutrition list), so no count or name is ever stored beyond that.
    select n.id into v_existing
    from public.notifications n
    where n.profile_id = c.profile_id and n.group_id = new.group_id and n.type = 'nutrition_baseline_ready' and n.read_at is null and n.created_at > now() - interval '1 day'
    order by n.created_at desc
    limit 1;
    if v_existing is not null then
      update public.notifications
      set body = 'Starting targets are ready for several clients', link_path = '/groups/' || new.group_id::text || '/nutrition'
      where id = v_existing;
    else
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (c.profile_id, new.group_id, 'nutrition_baseline_ready', 'A starting target is ready for ' || v_name, '/groups/' || new.group_id::text || '/nutrition?athleteId=' || new.athlete_id::text);
    end if;
  end loop;
  return new;
end;
$function$;

drop trigger if exists nutrition_baseline_notify on public.nutrition_checkin_suggestions;
create trigger nutrition_baseline_notify
  after insert on public.nutrition_checkin_suggestions
  for each row execute function public.notify_on_nutrition_baseline();

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 40 (0295)' as step, '0295 about you' as what, not ((to_regclass('public.client_phase_plans') is null) and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_profile_details' and column_name = 'activity_level')) and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_goals' and column_name = 'nutrition_phase'))) as in_place
) as result order by step;
