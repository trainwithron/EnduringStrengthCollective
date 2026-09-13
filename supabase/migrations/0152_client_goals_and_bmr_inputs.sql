-- Goal-date-aware nutrition/programming — the goals/schema core
-- (goal_date_aware_nutrition_and_programming_idea.md), scoped exactly to
-- the recommended first handoff: the goals table itself, the
-- dropdown+custom goal type, and the BMR inputs Mifflin-St Jeor/
-- Katch-McArdle need. Strength-peaking and cardio-tapering are
-- explicitly excluded from this pass per that same memory file.

-- Real history, not a single mutable row — every goal change is a new
-- row, never an update-in-place, which is what makes the goal-reversal
-- signal possible at all (it needs to know what the PREVIOUS confirmed
-- goal was and when it changed, not just the current state).
create table public.client_goals (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  goal_type text not null check (
    goal_type in ('weight_loss', 'body_recomp', 'muscle_gain', 'bodybuilding', 'powerbuilding_strongman', 'endurance_event', 'custom')
  ),
  custom_label text, -- only meaningful when goal_type = 'custom'
  priority_note text, -- free-text, e.g. "rear delts, show prep" — what a coach/spotter suppression layer actually reads
  target_date date, -- optional, not every goal has a hard deadline
  -- Event-specific fields, populated only for powerbuilding_strongman/endurance_event goals.
  event_type text,
  event_expected_duration_minutes int,
  event_priority text check (event_priority is null or event_priority in ('A', 'B', 'C')),
  -- Client proposes, coach confirms before it drives any real numbers —
  -- the already-locked governance rule. A goal never affects nutrition/
  -- programming targets while still 'proposed'.
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'declined')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id)
);
create index client_goals_athlete_id_idx on public.client_goals(athlete_id);
create index client_goals_group_id_idx on public.client_goals(group_id);

alter table public.client_goals enable row level security;
-- The client always sets/owns the goal (insert), the coach is kept in
-- the loop (select) and is the only one who can move it out of
-- 'proposed' (the confirm/decline update) — mirrors the exact
-- client-proposes/coach-confirms rule already locked for this feature.
create policy "client_goals_select_own_or_coach" on public.client_goals for select
  to authenticated using (athlete_id = (select auth.uid()) or is_group_coach(group_id));
create policy "client_goals_insert_own" on public.client_goals for insert
  to authenticated with check (athlete_id = (select auth.uid()) and created_by = (select auth.uid()));
create policy "client_goals_update_coach_confirms" on public.client_goals for update
  to authenticated using (is_group_coach(group_id)) with check (is_group_coach(group_id));

-- BMR inputs — height and biological sex don't exist anywhere in this
-- schema yet, both required for Mifflin-St Jeor. body_fat_pct is
-- nullable and manually entered for now (no automatic body-comp data
-- source is wired up yet — Withings' own integration only captures
-- weight) — Katch-McArdle activates automatically the moment a real
-- value exists here, from whatever source eventually provides one.
alter table public.athlete_profile_details
  add column height_cm numeric,
  add column biological_sex text check (biological_sex is null or biological_sex in ('male', 'female')),
  add column body_fat_pct numeric;
