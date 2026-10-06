-- A new direct message left no in-app notice at all: the bell and the notification list never mentioned it, so a client's message to their coach
-- (or the coach's reply) was only noticed if the person happened to open Messages. The push from the sender's phone also never arrived for
-- client-to-coach messages (fixed separately in the push route), so for most people the message simply sat there.
--
-- Now every new message writes one notification for the recipient, using the same pattern as comments (0073). It does NOT copy the message
-- text (the notice says who wrote, nothing more), and it is coalesced: while the recipient has an unread notice from this sender in this group,
-- a further message refreshes that one notice instead of adding another, so a burst of messages is one line, not twenty.
-- Needs 0140 (direct_messages), 0071 and 0243 (the notifications table and its type list). Re-runnable.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message'
  ));

create or replace function public.notify_on_direct_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_path text := '/groups/' || new.group_id::text || '/messages/' || new.sender_id::text;
  v_existing uuid;
begin
  select full_name into v_name from public.profiles where id = new.sender_id;

  select n.id into v_existing
  from public.notifications n
  where n.profile_id = new.recipient_id and n.type = 'direct_message' and n.link_path = v_path and n.read_at is null
  order by n.created_at desc
  limit 1;

  if v_existing is not null then
    update public.notifications set created_at = now() where id = v_existing;
  else
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (new.recipient_id, new.group_id, 'direct_message', coalesce(nullif(btrim(v_name), ''), 'Someone') || ' sent you a message', v_path);
  end if;
  return new;
end;
$$;

drop trigger if exists direct_messages_notify on public.direct_messages;
create trigger direct_messages_notify
  after insert on public.direct_messages
  for each row execute function public.notify_on_direct_message();
