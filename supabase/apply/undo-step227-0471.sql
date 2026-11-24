-- UNDO: step 227. Only if it must be taken back: removes the food check-ins (and every one sent), the per-client switch, the three notice types (their notices too) and puts
-- notice_kind_of back exactly as it was. Last result: one row, all true.

begin;

drop index if exists public.client_food_checkins_one_a_day;
drop table if exists public.client_food_checkins;
alter table public.client_nutrition_flags drop column if exists checkins_off;

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

delete from public.notifications where type in ('food_checkin', 'food_checkin_answered', 'food_checkin_sent');
do $types$
declare
  v_def text;
  v_have text[];
  v_keep text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  select array_agg(t order by t) into v_keep from unnest(v_have) as t where t not in ('food_checkin', 'food_checkin_answered', 'food_checkin_sent');
  if coalesce(cardinality(v_keep), 0) < 5 then
    raise exception 'Could not read the notification types (%). NOTHING was changed.', v_def;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_keep) as t));
end
$types$;

commit;

-- Check: one row, all true.
select
  to_regclass('public.client_food_checkins') is null as checkins_table_gone,
  to_regclass('public.client_food_checkins_one_a_day') is null as one_a_day_index_gone,
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_nutrition_flags' and column_name = 'checkins_off') as switch_gone,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass) not like '%food_checkin%' as notice_types_gone,
  md5(replace((select prosrc from pg_proc where oid = 'public.notice_kind_of(text)'::regprocedure), chr(13), '')) = '95fa7b1a9e7db12729dbbafd543e0821' as notice_kinds_as_before;
