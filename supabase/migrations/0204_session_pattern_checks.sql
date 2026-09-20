-- Session Pattern Spotter
-- (habit_spotter_and_post_workout_coach_page_research_sept19.md) — one
-- row per completed session this check ever ran against, whether or not
-- it found anything. The "found nothing" rows are the real mechanism
-- behind the design's own "checked, clear" passive indicator (never let
-- silence read as "we didn't check") — found_something=false rows are
-- expected to be the common case, not an error state.
create table public.session_pattern_checks (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null unique references public.athlete_sessions(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  found_something boolean not null default false,
  detected_signals jsonb not null default '[]'::jsonb,
  synthesis_text text,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create index session_pattern_checks_athlete_id_idx on public.session_pattern_checks(athlete_id);
create index session_pattern_checks_coach_id_idx on public.session_pattern_checks(coach_id);

alter table public.session_pattern_checks enable row level security;
create policy "session_pattern_checks_select_coach" on public.session_pattern_checks for select
  to authenticated using (public.is_group_coach(group_id));
create policy "session_pattern_checks_write_coach" on public.session_pattern_checks for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));

-- A real, group-scoped notification type (never null group_id, unlike
-- the org-dispatch bug fixed earlier tonight) so a coach who misses the
-- push still finds it through the existing per-group notification bell.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note'
  ));
