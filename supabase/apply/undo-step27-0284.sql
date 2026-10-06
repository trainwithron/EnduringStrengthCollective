-- UNDO for step 27 (0284). Only if goals misbehave after step 27. Removes the coach-proposal and client-answer rules and the two notice types (any such notices are deleted). A goal a coach already suggested stays as it is; after the undo only a coach can confirm goals again.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists client_goals_notify on public.client_goals;
drop trigger if exists client_goals_guard_update on public.client_goals;
drop function if exists public.notify_on_client_goal();
drop function if exists public.guard_client_goal_update();
drop policy if exists "client_goals_update_athlete_answers" on public.client_goals;
drop policy if exists "client_goals_insert_coach" on public.client_goals;
delete from public.notifications where type in ('goal_proposed', 'goal_answered');
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message', 'late_change', 'booking_request', 'request_decision'
  ));
commit;
