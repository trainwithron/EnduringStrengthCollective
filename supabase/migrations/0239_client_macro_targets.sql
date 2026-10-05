-- Standing macro targets: one coach-set target per client that applies every
-- day unless something more specific exists. Until now a target only existed
-- as a per-date row in daily_macros, so a client who just needs targets (no
-- meal plans) needed rows pre-written for every future day, and "no macros
-- set for next week" alerts fired as the written dates ran out.
--
-- Resolution order for a given day (lib/todays-macros.ts):
--   1. an explicit daily_macros row for that date (the coach's override)
--   2. a meal plan covering that day
--   3. this standing target
-- daily_macros is unchanged and keeps working exactly as before; it is now
-- simply "the override".
--
-- One row per athlete, like daily_macros (primary key on athlete). group_id is
-- kept for row-level security, the same way daily_macros does it.
create table if not exists public.client_macro_targets (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  calories int check (calories is null or calories between 0 and 20000),
  protein_g int check (protein_g is null or protein_g between 0 and 1500),
  carbs_g int check (carbs_g is null or carbs_g between 0 and 3000),
  fat_g int check (fat_g is null or fat_g between 0 and 1500),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index if not exists client_macro_targets_group_id_idx on public.client_macro_targets(group_id);

alter table public.client_macro_targets enable row level security;

create policy "client_macro_targets_coach_manage" on public.client_macro_targets for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

-- The athlete only ever reads their own target (the coach sets it).
create policy "client_macro_targets_athlete_select" on public.client_macro_targets for select
  to authenticated
  using (athlete_id = (select auth.uid()));
