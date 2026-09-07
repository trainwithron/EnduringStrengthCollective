-- ============================================================================
-- EXERCISE_LIBRARY — a coach's personal, reusable list of exercise names,
-- shared across every group they coach. Populated by usage: seeded once from
-- exercises already in their programs, then grows automatically whenever
-- they save a workout with a name not already in it. Powers a searchable
-- autocomplete in the workout builder, which also closes a real bug class —
-- exercise_name is matched by exact string everywhere (Last time lookups,
-- PR detection, progressions), so a typo silently breaks all three.
-- ============================================================================
create table public.exercise_library (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (created_by, name)
);

alter table public.exercise_library enable row level security;

-- Owner-only — this isn't group data, it's personal to the coach, so no
-- group-scoping helper is needed here.
create policy "exercise_library_select_own"
  on public.exercise_library for select
  to authenticated
  using (created_by = auth.uid());

create policy "exercise_library_insert_own"
  on public.exercise_library for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "exercise_library_delete_own"
  on public.exercise_library for delete
  to authenticated
  using (created_by = auth.uid());
