create table public.coach_availability_windows (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  slot_duration_minutes int not null default 60 check (slot_duration_minutes > 0),
  created_at timestamptz not null default now()
);

create table public.session_credits (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  balance int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, group_id)
);

create table public.bookings (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_at timestamptz not null default now()
);

-- The actual double-booking guard: a second confirmed booking for the
-- same coach at the same instant fails at the database level, so the
-- "shared pool, first person wins" rule holds even under a race — no
-- application-level locking needed.
create unique index bookings_no_double_book
  on public.bookings (coach_id, start_at)
  where status = 'confirmed';

-- Availability is coach-wide, so its RLS can't reuse is_group_coach
-- (group-scoped). New helper: is the viewer an athlete in ANY group this
-- coach coaches? Same shape/security-definer style as is_group_member.
create or replace function public.is_client_of_coach(target_coach_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.group_memberships gm_athlete
    join public.group_memberships gm_coach on gm_coach.group_id = gm_athlete.group_id
    where gm_athlete.profile_id = auth.uid() and gm_athlete.role = 'athlete'
      and gm_coach.profile_id = target_coach_id and gm_coach.role = 'coach'
  );
$$;

alter table public.coach_availability_windows enable row level security;
create policy "availability_coach_manage" on public.coach_availability_windows for all
  to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "availability_client_select" on public.coach_availability_windows for select
  to authenticated using (public.is_client_of_coach(coach_id));

alter table public.session_credits enable row level security;
create policy "credits_coach_manage" on public.session_credits for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
create policy "credits_athlete_select" on public.session_credits for select
  to authenticated using (athlete_id = auth.uid());
-- Athlete can adjust their own balance directly (booking/cancelling runs
-- client-side, same trust model already used everywhere else in this app
-- for e.g. workout volume/PR math — RLS gates ownership, not arithmetic).
create policy "credits_athlete_update_own" on public.session_credits for update
  to authenticated using (athlete_id = auth.uid()) with check (athlete_id = auth.uid());

alter table public.bookings enable row level security;
create policy "bookings_insert_own_client" on public.bookings for insert
  to authenticated with check (athlete_id = auth.uid() and public.is_client_of_coach(coach_id));
create policy "bookings_select_own_or_coach" on public.bookings for select
  to authenticated using (athlete_id = auth.uid() or coach_id = auth.uid());
create policy "bookings_update_own_or_coach" on public.bookings for update
  to authenticated using (athlete_id = auth.uid() or coach_id = auth.uid())
  with check (athlete_id = auth.uid() or coach_id = auth.uid());
