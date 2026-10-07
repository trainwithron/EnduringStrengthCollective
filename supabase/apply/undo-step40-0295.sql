-- UNDO for step 40 (0295). Only if step 40 misbehaves. Removes the phase-of-record table (every phase, review date and planned next phase is lost), the activity level and unit settings clients saved, and every baseline suggestion and record; puts the weight, calorie, adherence and recovery columns back to required; puts guard_client_goal_update back exactly as 0284 had it; deletes the new notification and puts the notification types back to the list the database had without it (read from the live list, so another release's types are kept).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $undo$ declare v_def text; v_have text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; delete from public.notifications where type = 'nutrition_baseline_ready'; select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m; v_have := array(select t from unnest(v_have) as t where t <> 'nutrition_baseline_ready'); alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_have) as t)); end $undo$;
drop trigger if exists nutrition_baseline_notify on public.nutrition_checkin_suggestions;
drop trigger if exists client_goals_phase_follows_confirm on public.client_goals;
drop trigger if exists client_goals_clear_phase_on_insert on public.client_goals;
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
      -- A counter-proposal: the client is now the author, so it goes back to the coach.
      new.status := 'proposed';
      new.created_by := v_uid;
      new.confirmed_at := null;
      new.confirmed_by := null;
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
alter table public.client_goals drop constraint if exists client_goals_nutrition_phase_ok;
alter table public.client_goals drop column if exists nutrition_phase;
drop table if exists public.client_phase_plans;
delete from public.nutrition_checkin_suggestions where kind = 'baseline';
delete from public.nutrition_checkins where kind = 'baseline';
alter table public.nutrition_checkin_suggestions drop constraint if exists nutrition_checkin_suggestions_weekly_complete;
alter table public.nutrition_checkins drop constraint if exists nutrition_checkins_weekly_complete;
alter table public.nutrition_checkin_suggestions alter column prev_weight_lbs set not null, alter column curr_weight_lbs set not null, alter column current_calories set not null, alter column adherence_days set not null, alter column recovery_rating set not null, alter column adjustment_pct set not null;
alter table public.nutrition_checkins alter column prev_weight_lbs set not null, alter column curr_weight_lbs set not null, alter column current_calories set not null, alter column adherence_days set not null, alter column recovery_rating set not null, alter column adjustment_pct set not null;
alter table public.nutrition_checkin_suggestions drop constraint if exists nutrition_checkin_suggestions_kind_ok;
alter table public.nutrition_checkins drop constraint if exists nutrition_checkins_kind_ok;
alter table public.nutrition_checkin_suggestions drop column if exists kind, drop column if exists below_floor;
alter table public.nutrition_checkins drop column if exists kind;
drop function if exists public.coach_set_body_profile(uuid, uuid, numeric, text, numeric, text, text, text, boolean);
drop function if exists public.notify_on_nutrition_baseline();
drop function if exists public.phase_follows_confirmed_goal();
drop function if exists public.clear_client_goal_phase_on_insert();
alter table public.athlete_profile_details drop constraint if exists athlete_profile_details_activity_level_ok, drop constraint if exists athlete_profile_details_weight_unit_ok, drop constraint if exists athlete_profile_details_portion_units_ok;
alter table public.athlete_profile_details drop column if exists activity_level, drop column if exists weight_unit, drop column if exists portion_units;
commit;
