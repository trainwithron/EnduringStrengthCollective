-- Real gap Ron caught directly: recompute_training_max() (migration
-- 0155) returned early whenever a set had no logged RPE, meaning a set
-- with no RPE never contributed to the training-max estimate at all —
-- not every athlete logs RPE on every set, so the estimate could go
-- long stretches without updating for a lot of real users.
--
-- Ron's own proposed fix: when RPE is missing, assume a high-effort
-- default (near-failure) rather than skipping the set entirely — "if
-- someone actually pushes, it'll be close enough," accepting it'll
-- overestimate for a set that wasn't actually pushed hard, as a real,
-- reasonable tradeoff over never updating at all. RPE 9 (1 rep in
-- reserve) is used rather than a flat 10 — slightly more conservative
-- than "assume an all-out max effort," while still landing close to
-- true failure per his own framing.
--
-- `source_rpe_assumed` records which case applied, so a value derived
-- from an assumed default is distinguishable from one the athlete
-- actually logged — useful later (e.g. a UI could show "estimated,
-- assumed effort" differently from a real logged RPE) without needing
-- a second migration to add that distinction after the fact.
alter table public.athlete_training_maxes
  add column source_rpe_assumed boolean not null default false;

create or replace function public.recompute_training_max()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_exercise_name text;
  v_athlete_id uuid;
  v_reserve_reps numeric;
  v_estimate numeric;
  v_rpe numeric;
  v_rpe_assumed boolean;
begin
  if new.status <> 'completed' or new.weight is null or new.reps is null
     or new.weight <= 0 or new.reps <= 0 then
    return new;
  end if;

  if new.rpe is null then
    v_rpe := 9;
    v_rpe_assumed := true;
  else
    v_rpe := new.rpe;
    v_rpe_assumed := false;
  end if;

  select se.exercise_name, s.athlete_id into v_exercise_name, v_athlete_id
  from public.session_exercises se
  join public.athlete_sessions s on s.id = se.session_id
  where se.id = new.session_exercise_id;

  if v_exercise_name is null or v_athlete_id is null then
    return new;
  end if;

  v_reserve_reps := greatest(0, 10 - v_rpe);
  v_estimate := round((new.weight * (1 + (new.reps + v_reserve_reps) / 30.0))::numeric, 1);

  insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe, source_rpe_assumed, updated_at)
  values (v_athlete_id, v_exercise_name, v_estimate, new.weight, new.reps, v_rpe, v_rpe_assumed, now())
  on conflict (athlete_id, exercise_name) do update
    set estimated_max = excluded.estimated_max,
        source_weight = excluded.source_weight,
        source_reps = excluded.source_reps,
        source_rpe = excluded.source_rpe,
        source_rpe_assumed = excluded.source_rpe_assumed,
        updated_at = excluded.updated_at
    where excluded.estimated_max > public.athlete_training_maxes.estimated_max;

  return new;
end;
$$;
