-- AI Program Builder injury-awareness (ai_output_foolproofing_and_
-- quality_assurance_idea.md's own flagged gap, closed per
-- injury_pain_science_research_and_ai_gap_sept15.md). A coach-facing
-- "this client has a flagged injury — review closely" notice needs to
-- show ONCE per (coach, athlete), not on every generation — Ron's own
-- real constraint: most clients report *some* PAR-Q+ history, so a
-- recurring flag would become noise fast, same discipline as the
-- existing 3-items-per-day coach-briefing cap.
create table public.athlete_injury_flag_acknowledgements (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (coach_id, athlete_id)
);

alter table public.athlete_injury_flag_acknowledgements enable row level security;
create policy "athlete_injury_flag_ack_own" on public.athlete_injury_flag_acknowledgements for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));
