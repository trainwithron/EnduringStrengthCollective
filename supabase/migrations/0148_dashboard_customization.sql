-- Coach Home dashboard redesign, customization layer
-- (coach_dashboard_redesign_scoping.md) — two independent preferences:
--
-- 1. Word-swap terminology: per-ORG (business-wide vocabulary identity,
--    not personal taste) — client/athlete/player, group/team/squad,
--    coach/trainer, session/workout/training, roster/team, program/plan,
--    each optionally overridden to a preset or a free-text custom word.
alter table public.organizations
  add column terminology_overrides jsonb not null default '{}'::jsonb;

-- 2. Dashboard tile arrangement: per-COACH (personal taste, needs to
--    follow a coach across devices — a real DB row, not a localStorage-
--    only convenience). Hidden/reordered tile keys for the Home bento
--    grid; the hero row (Right Now + Team Pulse) is never included here
--    since it isn't customizable at all.
create table public.coach_dashboard_layout (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  hidden_tiles text[] not null default '{}',
  tile_order text[] not null default '{}',
  -- Per-tile "which alternate value is currently shown" for the
  -- hover-peek/click-to-set stat tiles (e.g. {"mrr": "last_month"}).
  tile_metric_overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.coach_dashboard_layout enable row level security;
create policy "coach_dashboard_layout_own" on public.coach_dashboard_layout for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));
