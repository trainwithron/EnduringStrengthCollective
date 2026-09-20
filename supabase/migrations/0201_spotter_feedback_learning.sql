-- Spotter confirm/deny/edit feedback loop
-- (spotter_suggestive_only_top3_confirm_deny_edit_principle_sept19.md,
-- spotter_feedback_learning_loop_research_sept19.md). Two tables, exactly
-- the shape that research recommended: a raw per-decision event log
-- (never edited/deleted by the app, just appended to) and an extracted,
-- coach-confirmed condition->preference rule mirroring
-- coach_program_preferences (0164_ai_program_conversational_learning.sql)
-- so it can flow into the same generate-program prompt injection point.
-- Piloted on the Programming Spotter only, per that research's own
-- reasoning — spotter_kind stays a plain text column (not an enum) so a
-- second Spotter can reuse this schema later without a migration.

create table public.spotter_recommendation_feedback (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  spotter_kind text not null default 'programming',
  dismissal_key text not null, -- "${checkKind}::${patternKey}", same stable id the gather layer already computes
  option_summary text not null, -- the headline text shown at the moment of this decision
  action text not null check (action in ('confirmed', 'denied', 'edited')),
  edit_detail text,
  created_at timestamptz not null default now()
);
create index spotter_recommendation_feedback_lookup_idx
  on public.spotter_recommendation_feedback (coach_id, spotter_kind, dismissal_key, created_at desc);

alter table public.spotter_recommendation_feedback enable row level security;
create policy "spotter_recommendation_feedback_own" on public.spotter_recommendation_feedback for all
  to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());

create table public.spotter_coach_preferences (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  spotter_kind text not null default 'programming',
  condition_text text not null,
  preference_text text not null,
  source_dismissal_key text,
  created_at timestamptz not null default now()
);
create index spotter_coach_preferences_coach_id_idx on public.spotter_coach_preferences(coach_id);

alter table public.spotter_coach_preferences enable row level security;
create policy "spotter_coach_preferences_own" on public.spotter_coach_preferences for all
  to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
