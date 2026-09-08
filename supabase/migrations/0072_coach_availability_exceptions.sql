-- Time a coach is NOT bookable, on top of their recurring weekly windows.
-- Two shapes in one table: a one-off block (real start_at/end_at, can
-- span multiple days — a vacation week, or just a 2-hour dentist trip)
-- and a recurring block (weekday + time-of-day, repeats every week — a
-- daily lunch break). The shape check keeps a row from ever mixing both.
create table public.coach_availability_exceptions (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('one_off', 'recurring')),
  label text,
  start_at timestamptz,
  end_at timestamptz,
  weekday smallint check (weekday between 0 and 6),
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  constraint coach_availability_exceptions_shape check (
    (kind = 'one_off' and start_at is not null and end_at is not null
       and weekday is null and start_time is null and end_time is null)
    or
    (kind = 'recurring' and weekday is not null and start_time is not null and end_time is not null
       and start_at is null and end_at is null)
  )
);

alter table public.coach_availability_exceptions enable row level security;
create policy "availability_exceptions_coach_manage" on public.coach_availability_exceptions for all
  to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "availability_exceptions_client_select" on public.coach_availability_exceptions for select
  to authenticated using (public.is_client_of_coach(coach_id));
