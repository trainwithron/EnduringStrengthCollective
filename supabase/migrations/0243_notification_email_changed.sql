-- A coach can correct a client's email after the client has claimed their
-- account, and the client is told in the app. Adds that one notification type
-- (the list is 0210's, plus 'email_changed'). Until this is applied the
-- notification insert quietly fails; the email change itself still happens.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed'
  ));
