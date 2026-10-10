-- Stage 2 of the AI builder: it quietly learns from the changes a coach makes to an AI draft before signing it off.
--
--   * programs.ai_snapshot: what the AI wrote (week, day, order, exercise, sets, reps), saved when the draft is created, so the coach's changes can be seen at sign-off.
--   * coach_program_signoffs: one row per signed-off AI program (which exercises the AI wrote, how many changes the coach made, how many questions were asked) - the
--     "last 10 programs" and the "questions per program" count.
--   * coach_edit_events: each change the coach made (an exercise swapped for another, sets or reps changed, order changed, removed, added).
--   * coach_learned_rules: a pattern the app noticed and asked about, once. It is only ever applied after the coach says Yes, and the coach can undo it. The reason the coach
--     gave (typed or spoken) is kept with it. Applying a rule means writing a line into the coach's existing coach_program_preferences, which the builder already reads.
--   * coach_learning_settings: the plain on/off for being asked questions (off = still notes the changes, never asks).
-- Everything is private to the coach (row security: your own rows only). Safety rules are not here and cannot be changed from here: a learned line can only ADD a preference.
-- Requires 0164 (coach_program_preferences) and 0324.

alter table public.programs add column if not exists ai_snapshot jsonb;

create table public.coach_program_signoffs (
  program_id uuid primary key references public.programs(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  signed_at timestamptz not null default now(),
  exercises text[] not null default '{}',
  edits_count int not null default 0,
  questions_asked int not null default 0
);
create index coach_program_signoffs_coach_idx on public.coach_program_signoffs (coach_id, signed_at desc);

create table public.coach_edit_events (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  kind text not null check (kind in ('swap', 'sets_reps', 'order', 'removed', 'added')),
  from_name text,
  to_name text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index coach_edit_events_coach_idx on public.coach_edit_events (coach_id, kind, created_at desc);
create index coach_edit_events_program_idx on public.coach_edit_events (program_id);

create table public.coach_learned_rules (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'swap' check (kind in ('swap')),
  from_name text not null,
  to_name text not null,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'declined', 'undone')),
  evidence_count int not null,
  evidence_total int not null,
  reason_text text,
  rule_text text,
  preference_id uuid references public.coach_program_preferences(id) on delete set null,
  asked_for_program_id uuid references public.programs(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (coach_id, kind, from_name, to_name)
);
create index coach_learned_rules_coach_idx on public.coach_learned_rules (coach_id, status);

create table public.coach_learning_settings (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  questions_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.coach_program_signoffs enable row level security;
alter table public.coach_edit_events enable row level security;
alter table public.coach_learned_rules enable row level security;
alter table public.coach_learning_settings enable row level security;

create policy "coach_program_signoffs_own" on public.coach_program_signoffs for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "coach_edit_events_own" on public.coach_edit_events for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "coach_learned_rules_own" on public.coach_learned_rules for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "coach_learning_settings_own" on public.coach_learning_settings for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
