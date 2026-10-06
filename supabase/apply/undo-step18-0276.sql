-- UNDO for step 18 (0276). Only if sending a message fails after step 18. Removes the notice trigger and the notices it wrote, and puts the notification type list back.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists direct_messages_notify on public.direct_messages;
drop function if exists public.notify_on_direct_message();
delete from public.notifications where type = 'direct_message';
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed'
  ));
commit;
