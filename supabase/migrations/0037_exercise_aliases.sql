-- Self-learning alias dictionary for the workout importer: once a coach
-- confirms that a raw name from an imported file maps to a specific
-- library exercise, that mapping is stored here so future imports match it
-- automatically without asking again.
create table public.exercise_aliases (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  raw_name text not null,
  exercise_name text not null,
  created_at timestamptz not null default now(),
  unique (coach_id, raw_name)
);

alter table public.exercise_aliases enable row level security;

create policy "exercise_aliases_owner" on public.exercise_aliases for all
  to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());
