-- Release S, part 5: the "I'm away" preset reply (Ron, Oct 8: "a preset reply, not an automatic text").
--
-- The coach writes ONE reply, turns "I'm away" on (optionally with the last day), and while it is on every message a client sends them gets that reply back in the same thread.
--   * coach_away_replies(coach_id, enabled, message, ends_on, updated_at): one row per coach, readable and writable only by that coach.
--   * direct_messages.auto_reply: marks a message the database wrote from the preset (the thread shows it with a small "Auto-reply" note, so the coach can see which went out).
--     A person cannot mark their own message as an auto-reply, and cannot change the mark afterwards: only the function below can set it.
--   * send_away_reply(): after a CLIENT's message to their coach is added, writes the preset reply from the coach to that client, in the same group. It never reads the message.
--     It does nothing when: the new message is itself an auto-reply (no loops), the sender is a coach, the recipient is not a coach of the group, the coach has it off or no
--     reply text, the last day has passed (in the coach's time zone, New York when none is set), or this coach already auto-replied to this client in this group in the last
--     5 minutes (a burst of messages gets one reply, not many). Every other message gets the reply: it is not limited to one per period.
--   * The coach still gets the usual notice for the client's message (nothing about that changes), and the client gets the usual notice for the reply.
-- New table, one new column, three functions (all closed to signed-in users: they only ever run as triggers). Re-runnable.

create table if not exists public.coach_away_replies (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  message text not null default '' check (char_length(message) <= 1000),
  ends_on date,
  updated_at timestamptz not null default now()
);
alter table public.coach_away_replies enable row level security;
drop policy if exists "coach_away_replies_select_own" on public.coach_away_replies;
create policy "coach_away_replies_select_own" on public.coach_away_replies for select to authenticated using (coach_id = (select auth.uid()));
drop policy if exists "coach_away_replies_insert_own" on public.coach_away_replies;
create policy "coach_away_replies_insert_own" on public.coach_away_replies for insert to authenticated with check (coach_id = (select auth.uid()));
drop policy if exists "coach_away_replies_update_own" on public.coach_away_replies;
create policy "coach_away_replies_update_own" on public.coach_away_replies for update to authenticated
  using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
drop policy if exists "coach_away_replies_delete_own" on public.coach_away_replies;
create policy "coach_away_replies_delete_own" on public.coach_away_replies for delete to authenticated using (coach_id = (select auth.uid()));
revoke all on public.coach_away_replies from anon;
revoke truncate, references, trigger on public.coach_away_replies from authenticated;

alter table public.direct_messages add column if not exists auto_reply boolean not null default false;

-- Only send_away_reply() can set the mark (it flags the transaction first); anything a person sends or edits keeps it off / as it was.
create or replace function public.guard_direct_message_auto_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if coalesce(current_setting('app.away_reply', true), '') <> '1' then
        new.auto_reply := false;
      end if;
    else
      new.auto_reply := old.auto_reply;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists direct_messages_guard_auto_reply on public.direct_messages;
create trigger direct_messages_guard_auto_reply
  before insert or update on public.direct_messages
  for each row execute function public.guard_direct_message_auto_reply();

create or replace function public.send_away_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.coach_away_replies%rowtype;
  v_tz text;
begin
  if new.auto_reply then
    return new;
  end if;
  -- Only a client writing to their coach.
  if not exists (select 1 from public.group_memberships gm where gm.group_id = new.group_id and gm.profile_id = new.recipient_id and gm.role = 'coach') then
    return new;
  end if;
  if exists (select 1 from public.group_memberships gm where gm.group_id = new.group_id and gm.profile_id = new.sender_id and gm.role = 'coach') then
    return new;
  end if;

  select * into v_cfg from public.coach_away_replies where coach_id = new.recipient_id and enabled;
  if not found or btrim(v_cfg.message) = '' then
    return new;
  end if;

  if v_cfg.ends_on is not null then
    select timezone into v_tz from public.profiles where id = new.recipient_id;
    if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
      v_tz := 'America/New_York';
    end if;
    if (now() at time zone v_tz)::date > v_cfg.ends_on then
      return new;
    end if;
  end if;

  -- A burst of messages from the same client gets one reply.
  if exists (
    select 1 from public.direct_messages d
    where d.group_id = new.group_id and d.sender_id = new.recipient_id and d.recipient_id = new.sender_id
      and d.auto_reply and d.created_at > now() - interval '5 minutes'
  ) then
    return new;
  end if;

  perform set_config('app.away_reply', '1', true);
  -- created_at is the clock, not the start of the transaction, so the reply always sorts after the message it answers (both would otherwise carry the same time).
  insert into public.direct_messages (group_id, sender_id, recipient_id, body, auto_reply, created_at)
  values (new.group_id, new.recipient_id, new.sender_id, v_cfg.message, true, clock_timestamp());
  perform set_config('app.away_reply', '', true);
  return new;
end;
$$;

drop trigger if exists direct_messages_send_away_reply on public.direct_messages;
create trigger direct_messages_send_away_reply
  after insert on public.direct_messages
  for each row execute function public.send_away_reply();

revoke all on function public.guard_direct_message_auto_reply() from public, anon, authenticated;
revoke all on function public.send_away_reply() from public, anon, authenticated;
