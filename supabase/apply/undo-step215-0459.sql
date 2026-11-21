-- UNDO step 215: removes the weekly check-ins (every check-in sent is lost, the replies stay in Messages), their notices, the goal sheet's reviewed date and the scan counts (every
-- count is lost). The notice switch list goes back to migration 0423's. Paste and run.
begin;

drop function if exists public.count_machine_scans(timestamptz);
drop table if exists public.qr_scans;

alter table public.client_goal_sheets drop column if exists reviewed_at;

drop table if exists public.weekly_checkins;
drop function if exists public.weekly_checkins_guard();

-- the notices of the removed type, then the type itself (the same rebuild as the step, the other way)
delete from public.notifications where type = 'weekly_checkin';
do $types$
declare
  v_def text;
  v_keep text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null or v_def not like '%''weekly_checkin''%' then
    return;
  end if;
  select array_agg(m[1] order by m[1]) into v_keep from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m where m[1] <> 'weekly_checkin';
  if coalesce(cardinality(v_keep), 0) < 5 then
    raise exception 'Could not read the notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_keep) as t)
  );
end
$types$;

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

commit;
