-- Per-exercise leaderboard for team warm-up games (Jochum Ball,
-- Spikeball Reaction Warm-Up, Sapien Ball, Keep It Up — 0175) and any
-- future game exercise: a coach logs an athlete's score after playing,
-- ranked by best score per athlete (lib/game-leaderboard.ts). Keyed by
-- exercise_name, not exercise_library.id, matching this app's existing
-- convention for exercise-linked data (movement_pattern_exercises,
-- exercise_biomech_tags) — exercises are referenced by name everywhere
-- programs/logging touch them, not by a coach-scoped FK.
create table public.game_score_entries (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  exercise_name text not null,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  points numeric not null check (points >= 0),
  logged_at timestamptz not null default now(),
  logged_by uuid not null references public.profiles(id)
);
create index game_score_entries_group_exercise_idx on public.game_score_entries(group_id, exercise_name);
create index game_score_entries_athlete_idx on public.game_score_entries(athlete_id);

alter table public.game_score_entries enable row level security;

create policy "game_score_entries_select_members" on public.game_score_entries for select
  to authenticated using (public.is_group_member(group_id));

create policy "game_score_entries_write_coach" on public.game_score_entries for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
