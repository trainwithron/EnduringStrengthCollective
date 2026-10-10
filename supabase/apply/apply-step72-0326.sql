-- STEP 72: 0326 AI builder conversation: an optional chapter-by-chapter conversation where the app asks the coach how they program; the invitation's state and the conversation are private to the coach
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for anyone. Two private tables and three invitation columns are added. Nothing is asked until the coach chooses to start.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.coach_conversations') is null)) then
    raise exception 'Step 72 (0326) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0326_coach_conversation.sql
-- ====================================================================================================

-- Stage 4 of the AI builder: one optional conversation, in chapters, where the app asks the coach how they program. Only the programming chapter exists now; the tables are built
-- for more chapters (nutrition, schedule, clients) to plug in later with no change here.
--
--   * coach_conversations: one row per coach and chapter (active / done / skipped), how many answers the coach has given, and the read-back (the rules and style the app heard)
--     they were shown. Resuming is just opening the same row again.
--   * coach_conversation_messages: what was said, so a conversation can be resumed and so the coach can see what they said.
--   * coach_learning_settings (0325) gains the state of the one invitation: new, shown, later, declined, started, done - and how many reminders were shown (at most one).
-- Everything is private to the coach (row security: your own rows only). Nothing here changes a program, a client or a safety rule; what the coach confirms at the end is saved as
-- ordinary standing preferences (coach_program_preferences), which the coach can already remove. Requires 0325.

alter table public.coach_learning_settings add column if not exists invite_state text not null default 'new';
alter table public.coach_learning_settings drop constraint if exists coach_learning_settings_invite_state_check;
alter table public.coach_learning_settings add constraint coach_learning_settings_invite_state_check check (invite_state in ('new', 'shown', 'later', 'declined', 'started', 'done'));
alter table public.coach_learning_settings add column if not exists invite_shown_at timestamptz;
alter table public.coach_learning_settings add column if not exists invite_reminders int not null default 0;

create table public.coach_conversations (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  chapter text not null check (chapter in ('programming')),
  status text not null default 'active' check (status in ('active', 'done', 'skipped')),
  coach_turns int not null default 0,
  readback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coach_id, chapter)
);

create table public.coach_conversation_messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.coach_conversations(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('coach', 'assistant')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index coach_conversation_messages_conv_idx on public.coach_conversation_messages (conversation_id, created_at);

alter table public.coach_conversations enable row level security;
alter table public.coach_conversation_messages enable row level security;

create policy "coach_conversations_own" on public.coach_conversations for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
-- A message must be the coach's own AND sit in the coach's own conversation (nobody can add to, or probe for, someone else's).
create policy "coach_conversation_messages_own" on public.coach_conversation_messages for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and exists (select 1 from public.coach_conversations c where c.id = conversation_id and c.coach_id = (select auth.uid()))
  );

commit;
