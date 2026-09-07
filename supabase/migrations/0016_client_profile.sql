-- ============================================================================
-- Client profile support: a coach-private note per client, and a
-- self-reported body-weight log.
-- ============================================================================

-- Coach-private note about one client — never visible to the athlete.
create table public.athlete_notes (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  body text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, group_id)
);

alter table public.athlete_notes enable row level security;

create policy "athlete_notes_coach_only"
  on public.athlete_notes for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

-- Self-reported body weight — athlete logs it, coach can view/correct.
create table public.body_weight_logs (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  logged_date date not null default current_date,
  weight numeric not null,
  created_at timestamptz not null default now(),
  unique (athlete_id, logged_date)
);

create index idx_weight_logs_athlete on public.body_weight_logs(athlete_id);

alter table public.body_weight_logs enable row level security;

create policy "weight_logs_select_own_or_coach"
  on public.body_weight_logs for select
  to authenticated
  using (athlete_id = auth.uid() or public.is_group_coach(group_id));

create policy "weight_logs_write_own_or_coach"
  on public.body_weight_logs for all
  to authenticated
  using (athlete_id = auth.uid() or public.is_group_coach(group_id))
  with check (athlete_id = auth.uid() or public.is_group_coach(group_id));
