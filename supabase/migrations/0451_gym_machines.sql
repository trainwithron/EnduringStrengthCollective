-- Machines in the exercise library, each with a QR code that lists every exercise done on it (Ron, Nov 19: "on a machine I could put a QR code and it'll show you all of the exercise
-- variations for that machine ... Viking press, unilateral Viking press, shrugs, unilateral shrugs, you can sit in front of it and do a Z press"; "i need to obiously be able to add
-- excercises by machine in the excercise library also").
-- 1. gym_machines: a coach's machine (a name) and the organization it was made in (the gym shown on its QR page; a coach can own several). Only the coach who made it reads or
--    changes it, and only in an organization they belong to (or none).
-- 2. gym_machine_exercises: the exercises on a machine, in order. Only for a machine the coach owns AND an exercise from their own library.
-- Nobody signed out reads either table: the public scan page (/scan/machine/<id>) reads with the server's key, as the exercise scan page does. Nothing existing is changed. Re-running is safe.

create table if not exists public.gym_machines (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists gym_machines_created_by_idx on public.gym_machines (created_by);

create table if not exists public.gym_machine_exercises (
  machine_id uuid not null references public.gym_machines(id) on delete cascade,
  exercise_id uuid not null references public.exercise_library(id) on delete cascade,
  position int not null default 0,
  primary key (machine_id, exercise_id)
);
create index if not exists gym_machine_exercises_exercise_idx on public.gym_machine_exercises (exercise_id);

alter table public.gym_machines enable row level security;
alter table public.gym_machine_exercises enable row level security;
revoke all on public.gym_machines from anon, authenticated;
revoke all on public.gym_machine_exercises from anon, authenticated;
grant select, insert, update, delete on public.gym_machines to authenticated;
grant select, insert, update, delete on public.gym_machine_exercises to authenticated;

drop policy if exists "gym_machines_own" on public.gym_machines;
create policy "gym_machines_own" on public.gym_machines for all to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and (organization_id is null or public.is_org_member(organization_id)));

drop policy if exists "gym_machine_exercises_own" on public.gym_machine_exercises;
create policy "gym_machine_exercises_own" on public.gym_machine_exercises for all to authenticated
  using (
    exists (select 1 from public.gym_machines m where m.id = machine_id and m.created_by = (select auth.uid()))
    and exists (select 1 from public.exercise_library e where e.id = exercise_id and e.created_by = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.gym_machines m where m.id = machine_id and m.created_by = (select auth.uid()))
    and exists (select 1 from public.exercise_library e where e.id = exercise_id and e.created_by = (select auth.uid()))
  );
