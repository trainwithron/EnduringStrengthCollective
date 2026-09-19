-- equipment_variant_load_ratio_and_smart_swap_scoping_sept19.md — a
-- per-client learned load-conversion ratio between two equipment
-- variants of the same exercise (e.g. a machine leg press vs. a
-- barbell variant sharing the same movement_pattern_id), used to
-- pre-fill a weight suggestion when the athlete swaps mid-session.
--
-- Deliberately athlete_id-scoped, not gym-wide — Ron's own locked
-- decision: one client's machine calibration says nothing reliable
-- about another client's, even on the exact same equipment.
--
-- exercise_name_a/exercise_name_b are stored in a canonical order
-- (alphabetically, a < b) so there's exactly one row per pair per
-- athlete rather than two mirror-image rows — ratio is always
-- weight_b ÷ weight_a; lib/equipment-load-ratio.ts's
-- convertWeightAcrossVariants() handles converting in either
-- direction from that one stored value.
create table public.athlete_equipment_load_ratios (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  exercise_name_a text not null,
  exercise_name_b text not null,
  ratio numeric not null check (ratio > 0),
  sample_count int not null default 1 check (sample_count > 0),
  updated_at timestamptz not null default now(),
  unique (athlete_id, exercise_name_a, exercise_name_b)
);

create index idx_athlete_equipment_load_ratios_athlete on public.athlete_equipment_load_ratios(athlete_id);

alter table public.athlete_equipment_load_ratios enable row level security;

-- Purely a computed personal-history artifact (same character as the
-- correlating-week weight suggestion in lib/set-suggestions.ts, which
-- also isn't coach-facing) rather than coaching content — same
-- ownership-only trust model already used for
-- athlete_exercise_overrides' self-swap policy.
create policy "athlete_equipment_load_ratios_manage_own" on public.athlete_equipment_load_ratios for all
  to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
