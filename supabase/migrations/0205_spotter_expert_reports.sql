-- 3-layer Spotter framework
-- (two_layer_spotter_framework_architecture_research_sept19.md — file
-- name predates the mid-research revision from 2 to 3 tiers, see its
-- own header). One shared, tiered, self-tracing table: every Tier-1
-- variable-expert Spotter writes here instead of its own bespoke
-- storage; a Tier-2 cornerstone synthesis run writes its own rollup
-- back into the SAME table (tier=2, rolled_up_from populated); Tier 3
-- reads tier=2 rows the same way. One shape, one table, every tier just
-- a different filtered query against it — a 6th Spotter later needs
-- zero changes to the rollup/synthesis logic.
create table public.spotter_expert_reports (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  -- A Tier-1 kind ("programming_volume_concentration") OR a cornerstone
  -- name ("programming") at Tier 2, OR "overarching" at Tier 3. Plain
  -- text, not an enum -- a new Spotter/cornerstone needs no migration.
  spotter_kind text not null,
  tier smallint not null check (tier in (1, 2, 3)),
  cornerstone text not null check (cornerstone in ('business', 'programming', 'nutrition', 'calendar', 'habit_recovery')),
  -- Tier-1 report ids this row synthesizes -- null at Tier 1 itself,
  -- populated at Tier 2/3 so a claim can always trace back to its real
  -- source (same citation-chain integrity the numeral guard depends on).
  rolled_up_from uuid[],
  subject_type text not null check (subject_type in ('athlete', 'program', 'coach_business')),
  subject_id uuid,
  finding text not null,
  evidence_basis text not null,
  severity text not null check (severity in ('informational', 'worth_a_look', 'time_sensitive')),
  time_window_start timestamptz not null,
  time_window_end timestamptz not null,
  numeric_values numeric[] not null default '{}',
  dismissal_key text not null,
  report_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (coach_id, dismissal_key, tier, report_date)
);
create index spotter_expert_reports_coach_date_idx on public.spotter_expert_reports(coach_id, report_date);
create index spotter_expert_reports_cornerstone_idx on public.spotter_expert_reports(coach_id, cornerstone, tier, report_date);

alter table public.spotter_expert_reports enable row level security;
create policy "spotter_expert_reports_select_own" on public.spotter_expert_reports for select
  to authenticated using (coach_id = auth.uid());
-- No authenticated write policy -- only the service-role sync/synthesis
-- routes ever populate this table, same trust model as coach_briefings.
