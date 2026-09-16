-- Real client-safety gap found in tonight's memory audit
-- (coach_em_up_finley_funston_transcript.md): an injured client
-- currently just continues on whatever calorie deficit was already
-- active, with no system adjustment — undereating while injured
-- measurably delays recovery. Ron's decision: default to maintenance
-- or a real 5-10% surplus while a client is flagged as currently
-- injured, overriding any deficit phase.
--
-- A simple, manually-set interim mechanism — the full AI injury-
-- detection trigger (injury_keyword_ai_classification_idea.md) is
-- explicitly NOT part of this pass. One row per athlete (a client's
-- injury status isn't really per-group), group_id kept for the RLS
-- check and for the coach-scoped queries that need it.
create table public.athlete_injury_status (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  is_injured boolean not null default false,
  -- 0 = maintenance only; a coach can bump this up to a real 5-10%
  -- surplus while the athlete is injured, per Ron's own framing
  -- ("allow a coach to also bump to a real 5-10% surplus if they
  -- choose"). Capped at 10 — this isn't a bulking dial.
  surplus_pct numeric not null default 0 check (surplus_pct >= 0 and surplus_pct <= 10),
  marked_by uuid references public.profiles(id),
  marked_at timestamptz,
  updated_at timestamptz not null default now()
);

create index athlete_injury_status_group_id_idx on public.athlete_injury_status(group_id);

alter table public.athlete_injury_status enable row level security;

-- The athlete needs read access too — the nutrition-check-in override
-- and the athlete-facing recovery nudge both render on pages the
-- athlete views under their own auth context, not just the coach's.
create policy "athlete_injury_status_select_own_or_coach" on public.athlete_injury_status
  for select to authenticated
  using (athlete_id = (select auth.uid()) or is_group_coach(group_id));

-- Only the coach sets/clears this — matches Ron's own framing
-- ("a coach can set... coach clears the flag when the injury
-- resolves"), never an athlete self-report for this specific flag.
create policy "athlete_injury_status_write_coach" on public.athlete_injury_status
  for insert to authenticated
  with check (is_group_coach(group_id));

create policy "athlete_injury_status_update_coach" on public.athlete_injury_status
  for update to authenticated
  using (is_group_coach(group_id))
  with check (is_group_coach(group_id));
