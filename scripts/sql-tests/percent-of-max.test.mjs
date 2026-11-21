// Rehearses step 216 (migration 0460, wave 2 T3 percent of max) on an in-memory Postgres: stand-ins for the program tables, the LIVE duplicate_program as it was on Nov 20
// (fixtures/duplicate-program-live-nov20.sql, md5 of its body 1e083e62d0da8b1a895ef6fc1852d5b5), the migration twice, a copy that keeps each set's percent, the range check,
// then the undo (the function back exactly) and the paste (check row all true).
//   node scripts/sql-tests/percent-of-max.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const lf = (s) => s.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const read = (p) => lf(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.programs (id uuid primary key default gen_random_uuid(), group_id uuid, name text, description text, created_by uuid, athlete_id uuid, is_active boolean, start_date date, training_days int[],
    visibility_window int, training_intent text, cover_image_path text, ai_sequencing_notes text, source_program_id uuid, ai_draft boolean default false);
  create table public.exercise_progressions (id uuid primary key default gen_random_uuid(), program_id uuid, group_id uuid, exercise_name text, model text, config jsonb, tier_label text, slot text, created_by uuid);
  create table public.workouts (id uuid primary key default gen_random_uuid(), program_id uuid, group_id uuid, title text, week_number int, day_index int, notes text);
  create table public.group_workout_exercises (id uuid primary key default gen_random_uuid(), workout_id uuid, group_id uuid, exercise_name text, exercise_order int, movement_pattern_id uuid, tracked_fields text[],
    notes text, display_name text, is_slot boolean default false, slot_side text, slot_tier text, progression_slot text, superset_next boolean default false, athlete_id uuid);
  create table public.group_workout_exercise_sets (id uuid primary key default gen_random_uuid(), group_workout_exercise_id uuid, set_order int, target_reps text, target_weight numeric, target_rpe numeric,
    target_rir numeric, target_tempo text, target_time_seconds int, target_height numeric, target_distance numeric, rep_min int, rep_max int, target_rest_seconds int, target_rest_max_seconds int,
    target_pace text, set_type text default 'working');
  create table public.workout_notes (id uuid primary key default gen_random_uuid(), workout_id uuid, group_id uuid, body text, position int, created_by uuid);
`);
await db.exec(read("./fixtures/duplicate-program-live-nov20.sql"));
const migration = read("../../supabase/migrations/0460_percent_of_max.sql");
await db.exec(migration);
await db.exec(migration);

const failures = [];
const expect = (name, cond) => { if (!cond) failures.push(name); };
const coach = "11111111-1111-1111-1111-111111111111";
const group = "22222222-2222-2222-2222-222222222222";
const { rows: [prog] } = await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'Team strength', $2) returning id`, [group, coach]);
const { rows: [wk] } = await db.query(`insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day 1', 1, 0) returning id`, [prog.id, group]);
const { rows: [ex] } = await db.query(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Back Squat', 0) returning id`, [wk.id, group]);
await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps, target_pct_max) values ($1, 0, '5', 75), ($1, 1, '5', 80)`, [ex.id]);
await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps, target_weight) values ($1, 2, '5', 225)`, [ex.id]);

const { rows: [copy] } = await db.query(`select public.duplicate_program($1, $2, $3) as id`, [prog.id, group, coach]);
const copied = (await db.query(`select s.set_order, s.target_pct_max, s.target_weight from public.group_workout_exercise_sets s join public.group_workout_exercises e on e.id = s.group_workout_exercise_id
  join public.workouts w on w.id = e.workout_id where w.program_id = $1 order by s.set_order`, [copy.id])).rows;
expect("a copied program keeps each set's percent and each fixed weight", copied.length === 3 && Number(copied[0].target_pct_max) === 75 && Number(copied[1].target_pct_max) === 80 && Number(copied[2].target_weight) === 225 && copied[2].target_pct_max === null);

let refused = false;
try { await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_pct_max) values ($1, 3, 151)`, [ex.id]); } catch { refused = true; }
expect("a percent over 150 is refused", refused);
refused = false;
try { await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_pct_max) values ($1, 3, 0)`, [ex.id]); } catch { refused = true; }
expect("a percent of 0 is refused", refused);
const def = (await db.query(`select prosrc from pg_proc where proname = 'duplicate_program'`)).rows[0].prosrc;
expect("duplicate_program patched once (both column lists), even after running twice", def.split("target_pct_max").length - 1 === 2);

// undo, then the paste again
await db.exec(read("../../supabase/apply/undo-step216-0460.sql"));
const md5 = (await db.query(`select md5(prosrc) m from pg_proc where proname = 'duplicate_program'`)).rows[0].m;
expect(`undo: duplicate_program is exactly the live one again (${md5})`, md5 === "1e083e62d0da8b1a895ef6fc1852d5b5");
const col = (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'group_workout_exercise_sets' and column_name = 'target_pct_max'`)).rows[0].n;
expect("undo: the column is gone", col === 0);
const paste = read("../../supabase/apply/apply-step216-0460.sql");
expect("the paste is the migration word for word", paste.includes(migration.trimEnd()));
const results = await db.exec(paste);
const checkRow = results[results.length - 1].rows[0];
expect(`paste: the check row is all true (${JSON.stringify(checkRow)})`, Object.values(checkRow).length === 3 && Object.values(checkRow).every((v) => v === true));

if (failures.length) {
  console.error("FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("OK: step 216 rehearsal passed");
