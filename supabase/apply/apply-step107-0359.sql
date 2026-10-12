-- STEP 107: 0359 Weights from a history import (the FitPros import) no longer set training maxes, so an old number from another app cannot steer what a client, above all a minor, is prescribed
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. Live workouts and the coach's own quick-entry and spreadsheet history still set training maxes exactly as before; sets under a FitPros import (stamped noon, 00 minutes, 17 to 19 seconds) are left out.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((position('12:00:17' in pg_get_functiondef(to_regprocedure('public.recompute_training_max()'))) = 0)) then
    raise exception 'Step 107 (0359) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0359_imported_history_sets_do_not_set_training_maxes.sql
-- ====================================================================================================

-- Release BM: weights from a history import (the FitPros import) do not set training maxes.
-- A training max steers what a program prescribes (percentages, progressions, the AI builder), and nothing could take one back once an imported set had raised it. For a minor above all, an old
-- number from another app must not decide what they are asked to lift. Imported sessions carry an exact time stamp (noon, 00 minutes, 17 to 19 seconds; lib/fitpros-history.ts), and the
-- training-max trigger now leaves sets under such a session alone. Everything else is unchanged: live sets, and the coach's own quick-entry and spreadsheet history (stamped 12:00:00),
-- still set training maxes exactly as before.

create or replace function public.recompute_training_max()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exercise_name text;
  v_athlete_id uuid;
  v_historical boolean;
  v_started timestamptz;
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

  select se.exercise_name, s.athlete_id, s.is_historical, s.started_at into v_exercise_name, v_athlete_id, v_historical, v_started
  from public.session_exercises se
  join public.athlete_sessions s on s.id = se.session_id
  where se.id = new.session_exercise_id;

  if v_exercise_name is null or v_athlete_id is null then
    return new;
  end if;

  -- A history import's own time stamp: noon UTC, 00 minutes, 17 to 19 seconds.
  if coalesce(v_historical, false) and v_started is not null
     and (v_started at time zone 'UTC')::time between time '12:00:17' and time '12:00:19.999999' then
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

commit;
