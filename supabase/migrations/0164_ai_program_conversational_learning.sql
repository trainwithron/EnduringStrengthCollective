-- AI Program Builder conversational learning
-- (ai_program_builder_conversational_learning_idea.md) — a coach can ask
-- the AI "why did you do that" about a generated program, push back
-- with a correction, have the AI ask a scoping follow-up, and have that
-- correction actually apply to future generations.

-- Captured at generation time (same call as the rows themselves) so a
-- later "why" answer is grounded in what the model actually said when
-- it built the program, not a reconstructed-after-the-fact guess.
alter table public.programs add column ai_sequencing_notes text;

-- Reuses the existing Collective Intelligence chat pipeline
-- (coach_chat_threads/coach_chat_messages) for the correction
-- conversation itself, rather than a parallel table pair — a
-- program-correction thread is scoped to one program; a CI-chat thread
-- has none (program_id stays null there).
alter table public.coach_chat_threads
  add column program_id uuid references public.programs(id) on delete cascade;
create index coach_chat_threads_program_id_idx on public.coach_chat_threads(program_id);

-- One row per scoped condition->preference rule extracted from a
-- correction conversation, after the coach explicitly confirms it —
-- the actual mechanism Ron described ("what context determines this?"
-- turning a single correction into a properly-scoped rule instead of a
-- blanket one). Read back and injected into every future
-- generate-program call for that coach.
create table public.coach_program_preferences (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  condition_text text not null,
  preference_text text not null,
  source_program_id uuid references public.programs(id) on delete set null,
  created_at timestamptz not null default now()
);
create index coach_program_preferences_coach_id_idx on public.coach_program_preferences(coach_id);

alter table public.coach_program_preferences enable row level security;
create policy "coach_program_preferences_own" on public.coach_program_preferences for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));
