-- AI Assistant Phase 2 — Collective Intelligence conversational chat
-- (collective_intelligence_phase_2_conversational_assistant.md). Coach-only,
-- explicitly NOT cascaded to org admins (stricter than the daily briefing's
-- coach+org model — a chat is a more casual, exploratory surface). A daily
-- cron (app/api/cron/coach-chat-cleanup/route.ts) enforces the 90-day
-- retention window; RLS alone doesn't expire rows, so that cron is the real
-- enforcement, not just a nice-to-have.

create table public.coach_chat_threads (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index coach_chat_threads_coach_id_idx on public.coach_chat_threads(coach_id);

alter table public.coach_chat_threads enable row level security;
create policy "coach_chat_threads_own" on public.coach_chat_threads for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

create table public.coach_chat_messages (
  id uuid primary key default uuid_generate_v4(),
  thread_id uuid not null references public.coach_chat_threads(id) on delete cascade,
  -- Denormalized for a single-column RLS check, same convention as every
  -- other coach-owned table this session (coach_briefings, coach_packages).
  coach_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('coach', 'assistant')),
  body text not null,
  lookups_used text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index coach_chat_messages_thread_id_idx on public.coach_chat_messages(thread_id);
create index coach_chat_messages_coach_id_idx on public.coach_chat_messages(coach_id);

alter table public.coach_chat_messages enable row level security;
create policy "coach_chat_messages_own" on public.coach_chat_messages for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));
