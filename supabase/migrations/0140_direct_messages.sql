-- Coach<->Athlete direct messages (athlete_social_dm_video_chat_scoping
-- memory) — V1 messaging scope. Deliberately NOT peer-to-peer: the
-- insert policy actively enforces that one participant is the group's
-- coach and the other is an athlete member of that same group, so this
-- table can never quietly become an athlete-to-athlete channel. The
-- minor-oversight question (a coach can always see a minor's DMs) is a
-- non-issue here on purpose — the coach is always one of the two
-- participants in any row that can ever be inserted.
create table public.direct_messages (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index direct_messages_group_id_idx on public.direct_messages(group_id);
create index direct_messages_recipient_id_idx on public.direct_messages(recipient_id);
create index direct_messages_sender_id_idx on public.direct_messages(sender_id);

alter table public.direct_messages enable row level security;

create policy "dm_select_participant" on public.direct_messages for select
  to authenticated using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy "dm_insert_coach_athlete_pair" on public.direct_messages for insert
  to authenticated with check (
    sender_id = (select auth.uid())
    and public.is_group_member(group_id)
    and (
      (public.is_group_coach(group_id) and exists (
        select 1 from public.group_memberships gm
        where gm.group_id = direct_messages.group_id and gm.profile_id = recipient_id and gm.role = 'athlete'
      ))
      or
      (not public.is_group_coach(group_id) and exists (
        select 1 from public.group_memberships gm
        where gm.group_id = direct_messages.group_id and gm.profile_id = recipient_id and gm.role = 'coach'
      ))
    )
  );

-- Recipient marks their own received messages read; nothing else about
-- a message is ever editable.
create policy "dm_update_mark_read" on public.direct_messages for update
  to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

alter publication supabase_realtime add table public.direct_messages;
