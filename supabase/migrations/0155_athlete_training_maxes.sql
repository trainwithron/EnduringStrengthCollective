-- AI Program Builder methodology grounding
-- (ai_program_builder_methodology_grounding_idea.md) — a real, persisted
-- training max per athlete per lift, auto-estimated from sets already
-- being logged (RPE-aware, lib/rpe-training-max.ts) rather than a
-- dedicated max-test session. Needs zero new logging — set_logs already
-- tracks weight/reps/rpe on every set.
create table public.athlete_training_maxes (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  exercise_name text not null,
  estimated_max numeric not null,
  source_weight numeric not null,
  source_reps int not null,
  source_rpe numeric not null,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, exercise_name)
);

alter table public.athlete_training_maxes enable row level security;
create policy "training_maxes_select_own_or_coach" on public.athlete_training_maxes for select
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_coach_of_athlete(athlete_id));
-- No authenticated insert/update/delete policy at all — this number is
-- earned from real logged sets via the trigger below, same "not a typed-
-- in field" model as exercise_records' own current-holder logic.

-- Only ever moves up — a lighter/easier set logged later never erases a
-- harder set's estimate, matching how a real "current max" behaves.
create or replace function public.recompute_training_max()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_exercise_name text;
  v_athlete_id uuid;
  v_reserve_reps numeric;
  v_estimate numeric;
begin
  if new.status <> 'completed' or new.weight is null or new.rpe is null or new.reps is null
     or new.weight <= 0 or new.reps <= 0 then
    return new;
  end if;

  select se.exercise_name, s.athlete_id into v_exercise_name, v_athlete_id
  from public.session_exercises se
  join public.athlete_sessions s on s.id = se.session_id
  where se.id = new.session_exercise_id;

  if v_exercise_name is null or v_athlete_id is null then
    return new;
  end if;

  v_reserve_reps := greatest(0, 10 - new.rpe);
  v_estimate := round((new.weight * (1 + (new.reps + v_reserve_reps) / 30.0))::numeric, 1);

  insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe, updated_at)
  values (v_athlete_id, v_exercise_name, v_estimate, new.weight, new.reps, new.rpe, now())
  on conflict (athlete_id, exercise_name) do update
    set estimated_max = excluded.estimated_max,
        source_weight = excluded.source_weight,
        source_reps = excluded.source_reps,
        source_rpe = excluded.source_rpe,
        updated_at = excluded.updated_at
    where excluded.estimated_max > public.athlete_training_maxes.estimated_max;

  return new;
end;
$$;

create trigger trg_recompute_training_max
  after insert or update on public.set_logs
  for each row execute function public.recompute_training_max();
