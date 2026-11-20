// Migration 0454 (supersets and the set types a coach chooses) in an in-memory Postgres. start_workout_session is the LIVE definition as it was on Nov 20 (read with pg_get_functiondef), and
// duplicate_program a stand-in with the same signature and the same two column lists the live one copies exercises with. The paste runs (and runs again), the check row is all true, a started
// workout keeps each set's type (an unknown or missing type is a working set), a duplicated program keeps its links, and the undo puts both functions back and removes the column.
// Run: node scripts/sql-tests/supersets-set-types.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8");
const paste = file("apply/apply-step210-0454.sql");
const undo = file("apply/undo-step210-0454.sql");

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create table public.programs (id uuid primary key default gen_random_uuid(), name text);
  create table public.workouts (id uuid primary key default gen_random_uuid(), program_id uuid references public.programs(id));
  create table public.group_workout_exercises (
    id uuid primary key default gen_random_uuid(), workout_id uuid references public.workouts(id), group_id uuid, exercise_name text, exercise_order int,
    movement_pattern_id uuid, tracked_fields text[], notes text, display_name text, is_slot boolean not null default false, slot_side text, slot_tier text, progression_slot text not null default ''
  );
  create table public.group_workout_exercise_sets (
    id uuid primary key default gen_random_uuid(), group_workout_exercise_id uuid references public.group_workout_exercises(id) on delete cascade, set_order int, target_reps text,
    target_rest_max_seconds numeric, target_pace text, set_type text not null default 'working'
  );
  create table public.athlete_sessions (
    id uuid primary key default gen_random_uuid(), workout_id uuid, group_id uuid, athlete_id uuid, logged_by_coach boolean, session_type_id uuid, deduct_session_credit boolean, booking_id uuid,
    status text not null default 'in_progress', started_at timestamptz not null default now()
  );
  create table public.session_exercises (
    id uuid primary key default gen_random_uuid(), session_id uuid references public.athlete_sessions(id), group_workout_exercise_id uuid, exercise_name text, exercise_order int,
    movement_pattern_id uuid, tracked_fields text[]
  );
  create table public.set_logs (
    id uuid primary key default gen_random_uuid(), session_exercise_id uuid references public.session_exercises(id), set_order int, weight numeric, reps int,
    set_type text not null default 'working' check (set_type in ('warmup', 'working', 'amrap', 'backoff', 'drop'))
  );

  -- the stand-in: the same signature and the same column lists the live duplicate_program copies an exercise and its sets with
  create function public.duplicate_program(p_program_id uuid, p_destination_group_id uuid, p_athlete_id uuid, p_by uuid, p_name text, p_start date) returns uuid
  language plpgsql set search_path = public as $f$
  declare
    v_new uuid; w record; e record; v_new_w uuid; v_new_e uuid;
  begin
    insert into public.programs (name) values (p_name) returning id into v_new;
    for w in select * from public.workouts where program_id = p_program_id loop
      insert into public.workouts (program_id) values (v_new) returning id into v_new_w;
      for e in select * from public.group_workout_exercises where workout_id = w.id order by exercise_order loop
        insert into public.group_workout_exercises (
          workout_id, group_id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes, display_name,
          is_slot, slot_side, slot_tier, progression_slot
        )
        values (
          v_new_w, p_destination_group_id, e.exercise_name, e.exercise_order,
          e.movement_pattern_id, e.tracked_fields, e.notes, e.display_name,
          e.is_slot, e.slot_side, e.slot_tier, e.progression_slot
        )
        returning id into v_new_e;
        insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps, target_rest_max_seconds, target_pace, set_type)
        select v_new_e, set_order, target_reps, target_rest_max_seconds, target_pace, set_type from public.group_workout_exercise_sets where group_workout_exercise_id = e.id;
      end loop;
    end loop;
    return v_new;
  end
  $f$;
`);
// start_workout_session exactly as the live database had it on Nov 20 (its own line endings)
await db.exec(readFileSync(new URL("./fixtures/start-workout-session-live-nov20.sql", import.meta.url), "utf8"));

async function rows(sql) {
  return (await db.query(sql)).rows;
}

// the paste, twice
await db.exec(paste);
await db.exec(paste);
const check = (await rows(paste.slice(paste.indexOf("\nselect", paste.indexOf("-- Check"))).trim().replace(/;$/, "")))[0];
assert.deepEqual(Object.values(check), [true, true, true, true, true], JSON.stringify(check));

// a workout started with the coach's set types: each kept, an unknown or missing one is a working set
const session = (
  await rows(`select public.start_workout_session(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), false, null, false, null,
    '[{"exercise_name": "Bench Press", "exercise_order": 0, "tracked_fields": ["reps", "weight"], "sets": [
       {"set_order": 0, "reps": "8", "set_type": "warmup"}, {"set_order": 1, "reps": "5", "set_type": "amrap"}, {"set_order": 2, "set_type": "drop"},
       {"set_order": 3, "set_type": "backoff"}, {"set_order": 4, "set_type": "nonsense"}, {"set_order": 5}]}]'::jsonb) as id`)
)[0].id;
const types = (await rows(`select s.set_type from public.set_logs s join public.session_exercises e on e.id = s.session_exercise_id where e.session_id = '${session}' order by s.set_order`)).map((r) => r.set_type);
assert.deepEqual(types, ["warmup", "amrap", "drop", "backoff", "working", "working"]);
// the reps still land as before
assert.equal((await rows(`select reps from public.set_logs where set_order = 1 and set_type = 'amrap'`))[0].reps, 5);

// a duplicated program keeps its links (and its set types)
const prog = (await rows(`insert into public.programs (name) values ('Upper') returning id`))[0].id;
const work = (await rows(`insert into public.workouts (program_id) values ('${prog}') returning id`))[0].id;
await db.exec(`
  insert into public.group_workout_exercises (workout_id, exercise_name, exercise_order, superset_next) values
    ('${work}', 'Bench Press', 0, true), ('${work}', 'Row', 1, false), ('${work}', 'Curl', 2, false);
  insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, set_type)
    select id, 0, 'amrap' from public.group_workout_exercises where exercise_name = 'Bench Press' and workout_id = '${work}';
`);
assert.equal((await rows(`select superset_next from public.group_workout_exercises where exercise_name = 'Curl'`))[0].superset_next, false, "every exercise defaults to not linked");
const copy = (await rows(`select public.duplicate_program('${prog}', gen_random_uuid(), null, null, 'Copy', null) as id`))[0].id;
const copied = await rows(`select e.exercise_name, e.superset_next from public.group_workout_exercises e join public.workouts w on w.id = e.workout_id where w.program_id = '${copy}' order by e.exercise_order`);
assert.deepEqual(copied.map((r) => [r.exercise_name, r.superset_next]), [["Bench Press", true], ["Row", false], ["Curl", false]]);
assert.equal(
  (await rows(`select s.set_type from public.group_workout_exercise_sets s join public.group_workout_exercises e on e.id = s.group_workout_exercise_id join public.workouts w on w.id = e.workout_id where w.program_id = '${copy}'`))[0].set_type,
  "amrap"
);

// a function that no longer holds a list exactly once is refused, and nothing changes
await db.exec(undo);
await db.exec(`create or replace function public.duplicate_program(p_program_id uuid, p_destination_group_id uuid, p_athlete_id uuid, p_by uuid, p_name text, p_start date) returns uuid
  language sql as $f$ select null::uuid $f$;`);
await assert.rejects(db.exec(paste), /duplicate_program does not hold/);
await db.exec("rollback"); // the editor ends a failed paste the same way: its begin is never committed
assert.equal((await rows(`select count(*)::int as n from information_schema.columns where table_name = 'group_workout_exercises' and column_name = 'superset_next'`))[0].n, 0, "a refused paste adds nothing");

// the undo put start_workout_session back exactly as it was
const startNow = (await rows(`select pg_get_functiondef('public.start_workout_session(uuid, uuid, uuid, boolean, uuid, boolean, uuid, jsonb)'::regprocedure) as d`))[0].d;
assert.ok(!startNow.includes("set_type"), "the undo takes the set type back out");
assert.ok(startNow.includes("insert into public.set_logs (session_exercise_id, set_order, weight, reps)"));

console.log("supersets and set types: ok");
