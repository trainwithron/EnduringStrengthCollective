-- Real ask: bundle a training program alongside a challenge at creation
-- time (live_walkthrough_round2_findings.md). Nullable — a challenge
-- never required a program before and most still won't. "on delete set
-- null" rather than cascade: deleting the linked program should never
-- also delete the challenge, its participants, or its habits.
alter table public.challenges
  add column program_id uuid references public.programs(id) on delete set null;
