-- A coach's own switches for the KINDS of notice the app sends them (Settings > Notifications): one on/off per kind, and one switch controls BOTH the push and the notice in the app.
--   profiles.notices_off    the kinds this person turned OFF (empty = everything on, the default). A person can change only their own row (the existing profile policies).
--   notice_kind_of(type)    which kind a notification type belongs to (messages, bookings, client_activity, milestones, requests, session_notes, payments, team); null for the types that are not switchable (an account
--                           closing, an invitation, an email change, a guardian's consent, a support reply...). The same list is in lib/coach-notice-kinds.ts; a test keeps the two in step.
--   a BEFORE INSERT trigger on notifications drops a notice (no row, so no push from the 5-minute push job either) when its recipient switched that kind off. It is the ONE place that decides this for every writer:
--   database triggers, scheduled jobs and the app's routes alike. Everything else is untouched.
-- The pushes the app sends directly (low sessions, daily briefing, payments...) check the same list in code (lib/coach-notice.ts). Adds one column, two functions and one trigger. Re-runnable.

alter table public.profiles add column if not exists notices_off text[] not null default '{}';

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

create or replace function public.notifications_respect_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.profile_id is not null
     and exists (select 1 from public.profiles p where p.id = new.profile_id and public.notice_kind_of(new.type) = any (p.notices_off)) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_respect_switch on public.notifications;
create trigger notifications_respect_switch
  before insert on public.notifications
  for each row execute function public.notifications_respect_switch();

revoke all on function public.notifications_respect_switch() from public, anon, authenticated;
revoke all on function public.notice_kind_of(text) from public, anon;
grant execute on function public.notice_kind_of(text) to authenticated, service_role;
