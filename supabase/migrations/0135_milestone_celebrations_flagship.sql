-- Milestone Celebrations, flagship (milestone_celebration_system_scoping.md)
-- — the reverse-diet / metabolic-adaptation detector's schema.

-- One row per (athlete, group) — the athlete's currently-tagged
-- nutrition phase, coach-set only. No row = no phase tagged. Required
-- so the reverse-diet milestone only fires for an athlete the coach has
-- explicitly identified as running that protocol, avoiding a false
-- "congratulations" for someone who just happened to eat more without
-- gaining but wasn't actually on a deliberate reverse diet.
create table public.nutrition_phases (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  phase text not null check (phase in ('reverse_diet')),
  started_at date not null default current_date,
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (athlete_id, group_id)
);

alter table public.nutrition_phases enable row level security;
create policy "nutrition_phases_select_own_or_coach" on public.nutrition_phases for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "nutrition_phases_write_coach_only" on public.nutrition_phases for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));

-- Dedupe/cooldown ledger for every Milestone Celebrations detector-driven
-- event. Cooldown logic (don't refire the same athlete+type again for N
-- weeks) belongs in the cron job's own query, not a schema constraint —
-- this table just durably records what's already fired. No anon policy
-- at all: the public share page reads one exact row via the service-role
-- client (same pattern already used for the share card's own sensitive
-- signals), never through an anon-facing grant.
create table public.milestone_events (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  milestone_type text not null check (milestone_type in ('reverse_diet')),
  detail jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now()
);
create index milestone_events_athlete_type_idx on public.milestone_events(athlete_id, milestone_type, detected_at);

alter table public.milestone_events enable row level security;
create policy "milestone_events_select_own_or_coach" on public.milestone_events for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

-- First double-target notification type in the app — both the athlete
-- and their coach get one, since this milestone is a shared win, not an
-- athlete-only badge.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('comment', 'program_assigned', 'macros_assigned', 'partner_request', 'partner_request_accepted', 'milestone_celebration'));
