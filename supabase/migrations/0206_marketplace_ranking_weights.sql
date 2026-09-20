-- Marketplace coach-ranking algorithm, Phase 1
-- (marketplace_coach_ranking_algorithm_research_sept19.md) — a real,
-- visible, platform-admin-adjustable weighting for the distance/
-- goal-fit/outcome blend, explicitly NOT a hidden hardcoded blend like
-- the org-dispatch ranking's own already-flagged gap. Singleton-row
-- table (the "id boolean primary key default true check (id)" trick
-- guarantees exactly one row can ever exist).
create table public.marketplace_ranking_weights (
  id boolean primary key default true check (id),
  distance_weight numeric not null default 0.3 check (distance_weight >= 0),
  goal_fit_weight numeric not null default 0.3 check (goal_fit_weight >= 0),
  outcome_weight numeric not null default 0.4 check (outcome_weight >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.marketplace_ranking_weights (id) values (true);

alter table public.marketplace_ranking_weights enable row level security;

-- Readable by any authenticated user — the marketplace ranking that
-- consumes this is not itself gated to coaches/admins, and there's
-- nothing sensitive in a set of blend weights.
create policy "marketplace_ranking_weights_select_any" on public.marketplace_ranking_weights for select
  to authenticated using (true);

create policy "marketplace_ranking_weights_write_platform_admin" on public.marketplace_ranking_weights for all
  to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
