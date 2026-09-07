-- Coach-defined recurring habit for one client (e.g. "Drink 100oz water",
-- assigned on Mon/Wed/Fri). The client checks it off each day it's due.
create table public.client_habits (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[]
    constraint client_habits_weekdays_valid check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.client_habits enable row level security;
create policy "client_habits_coach_manage" on public.client_habits for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
create policy "client_habits_athlete_select" on public.client_habits for select
  to authenticated using (athlete_id = auth.uid());

-- One check-off row per (habit, date). Athlete checks off their own; a
-- coach can also mark one done directly (e.g. logging an in-person day).
create table public.habit_logs (
  id uuid primary key default uuid_generate_v4(),
  habit_id uuid not null references public.client_habits(id) on delete cascade,
  log_date date not null,
  completed_at timestamptz,
  unique (habit_id, log_date)
);
alter table public.habit_logs enable row level security;
create policy "habit_logs_write" on public.habit_logs for all
  to authenticated using (
    exists (select 1 from public.client_habits ch where ch.id = habit_id
      and (ch.athlete_id = auth.uid() or public.is_group_coach(ch.group_id)))
  )
  with check (
    exists (select 1 from public.client_habits ch where ch.id = habit_id
      and (ch.athlete_id = auth.uid() or public.is_group_coach(ch.group_id)))
  );

-- Coach-set daily macro targets, one row per athlete per date.
create table public.daily_macros (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  log_date date not null,
  calories int,
  protein_g int,
  carbs_g int,
  fat_g int,
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (athlete_id, log_date)
);
alter table public.daily_macros enable row level security;
create policy "daily_macros_coach_manage" on public.daily_macros for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
create policy "daily_macros_athlete_select" on public.daily_macros for select
  to authenticated using (athlete_id = auth.uid());

-- A coach-assigned workout override for one athlete on one specific date —
-- additive to the shared group program, not a replacement for it.
create table public.workout_assignments (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  scheduled_date date not null,
  workout_id uuid references public.workouts(id) on delete cascade,
  note text,
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (athlete_id, scheduled_date)
);
alter table public.workout_assignments enable row level security;
create policy "workout_assignments_coach_manage" on public.workout_assignments for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
create policy "workout_assignments_athlete_select" on public.workout_assignments for select
  to authenticated using (athlete_id = auth.uid());
