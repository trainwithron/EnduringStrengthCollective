// Step 219 (migration 0463) in an in-memory Postgres, against the LIVE duplicate_program and notice_kind_of (fixtures/wave3-live-functions-nov20.sql, each matched to live by md5):
//   the paste runs (and runs again) to a check row of all true; a copy keeps a section header as a header; how long one-on-one clients stay is read under the page's privacy (a coach their
//   own clients, removed ones too; an owner or admin the organization's except a private client; never a team; nobody else anything); "every week from here on" changes only the same
//   slot of later weeks that still holds the exercise (by place, or by progression slot), keeps each week's sets, carries or copies the progression rule, is refused on a team program for a
//   client and for strangers, and its undo puts back exactly what it changed; the new notice type is allowed and under Client activity; the undo puts both functions back to the live md5.
// Run: node scripts/sql-tests/wave3-builder-clients.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const lf = (s) => s.split("\r\n").join("\n");
const file = (p) => lf(readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8"));
const paste = file("apply/apply-step219-0463.sql");
const undo = file("apply/undo-step219-0463.sql");
assert.ok(paste.includes(file("migrations/0463_wave3_builder_clients.sql").trimEnd()), "the paste carries the migration as written");
const LIVE = { duplicate_program: "4517cdbe856943daf1a925820a0531a5", notice_kind_of: "503b0e97bd7a2e6c37c1ddb47d5f5fcd" };

const COACH = "11111111-1111-1111-1111-111111111111";
const OTHER_COACH = "22222222-2222-2222-2222-222222222222";
const OWNER = "33333333-3333-3333-3333-333333333333";
const ANN = "44444444-4444-4444-4444-444444444444"; // a one-on-one client of COACH
const BO = "55555555-5555-5555-5555-555555555555"; // another, private from the organization
const CY = "66666666-6666-6666-6666-666666666666"; // removed
const TEAMMATE = "77777777-7777-7777-7777-777777777777"; // on a team
const G_ANN = "99999999-0000-0000-0000-000000000001";
const G_BO = "99999999-0000-0000-0000-000000000002";
const G_CY = "99999999-0000-0000-0000-000000000003";
const G_TEAM = "99999999-0000-0000-0000-000000000004";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (id uuid primary key);
  create table public.groups (id uuid primary key, group_kind text, organization_id uuid);
  create table public.group_memberships (id uuid primary key default gen_random_uuid(), group_id uuid, profile_id uuid, role text, joined_at timestamptz default now(), private_from_org boolean default false);
  create table public.organization_admins (organization_id uuid, profile_id uuid);
  create function public.is_group_coach(_group_id uuid) returns boolean language sql stable as $$ select exists (select 1 from public.group_memberships where group_id = _group_id and profile_id = auth.uid() and role = 'coach') $$;
  create function public.my_admin_group_ids() returns setof uuid language sql stable as $$ select g.id from public.groups g join public.organization_admins a on a.organization_id = g.organization_id where a.profile_id = auth.uid() $$;
  create table public.client_removals (id uuid primary key default gen_random_uuid(), group_id uuid, athlete_id uuid, membership jsonb, removed_at timestamptz default now(), restored_at timestamptz, purged_at timestamptz);
  create table public.workout_logs (id uuid primary key default gen_random_uuid(), group_id uuid, athlete_id uuid, created_at timestamptz);
  create table public.bookings (id uuid primary key default gen_random_uuid(), group_id uuid, athlete_id uuid, start_at timestamptz, status text);
  create table public.programs (id uuid primary key default gen_random_uuid(), group_id uuid, name text, description text, created_by uuid, athlete_id uuid, is_active boolean, start_date date, training_days int[],
    visibility_window int, training_intent text, cover_image_path text, ai_sequencing_notes text, source_program_id uuid, ai_draft boolean default false, org_program boolean default false);
  create table public.exercise_progressions (id uuid primary key default gen_random_uuid(), program_id uuid, group_id uuid, exercise_name text, model text, config jsonb, tier_label text, slot text not null default '',
    created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
  create unique index exercise_progressions_program_exercise_slot_key on public.exercise_progressions (program_id, exercise_name, slot);
  create table public.workouts (id uuid primary key default gen_random_uuid(), program_id uuid, group_id uuid, title text, week_number int, day_index int, notes text, athlete_id uuid);
  create table public.group_workout_exercises (id uuid primary key default gen_random_uuid(), workout_id uuid, group_id uuid, exercise_name text, exercise_order int, movement_pattern_id uuid, tracked_fields text[],
    notes text, display_name text, is_slot boolean default false, slot_side text, slot_tier text, progression_slot text default '', superset_next boolean default false, athlete_id uuid);
  create table public.group_workout_exercise_sets (id uuid primary key default gen_random_uuid(), group_workout_exercise_id uuid, set_order int, target_reps text, target_weight numeric, target_rpe numeric,
    target_rir numeric, target_tempo text, target_time_seconds int, target_height numeric, target_distance numeric, rep_min int, rep_max int, target_rest_seconds int, target_rest_max_seconds int,
    target_pace text, set_type text default 'working', target_pct_max numeric);
  create table public.workout_notes (id uuid primary key default gen_random_uuid(), workout_id uuid, group_id uuid, body text, position int, created_by uuid);
  create table public.notifications (id uuid primary key default gen_random_uuid(), profile_id uuid, group_id uuid, type text, body text, link_path text,
    constraint notifications_type_check check (type = any (array['direct_message'::text, 'weekly_checkin'::text, 'team_sheet_saved'::text])));
`);
await db.exec(lf(readFileSync(new URL("./fixtures/wave3-live-functions-nov20.sql", import.meta.url), "utf8")));
const bodyMd5 = async (name) => (await db.query(`select md5(replace(prosrc, E'\\r\\n', E'\\n')) m from pg_proc where proname = $1`, [name])).rows[0].m;
for (const [n, m] of Object.entries(LIVE)) assert.equal(await bodyMd5(n), m, `${n} fixture is live`);

const as = async (who) => db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ""}', false)`);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const checkRow = async () => (await db.query(paste.slice(paste.indexOf("-- Check: one row, all true.")))).rows[0];

// ---- apply (twice) ----
await db.exec(paste);
let c = await checkRow();
assert.ok(Object.values(c).every((v) => v === true), JSON.stringify(c));
assert.equal(Object.keys(c).length, 7);
await db.exec(paste);
c = await checkRow();
assert.ok(Object.values(c).every((v) => v === true), JSON.stringify(c));
// only the two lines changed in each function
const patchedDup = lf((await one(`select prosrc s from pg_proc where proname = 'duplicate_program'`)).s);
assert.equal(
  (await one(`select md5($1) m`, [patchedDup.replace("position, created_by, is_header)", "position, created_by)").replace("position, v_by, is_header", "position, v_by")])).m,
  LIVE.duplicate_program
);
const patchedKind = lf((await one(`select prosrc s from pg_proc where proname = 'notice_kind_of'`)).s);
assert.equal((await one(`select md5($1) m`, [patchedKind.replace("    when 'exercise_swap' then 'client_activity'\n", "")])).m, LIVE.notice_kind_of);

// ---- people and spaces ----
await db.exec(`
  insert into public.profiles values ('${COACH}'), ('${OTHER_COACH}'), ('${OWNER}'), ('${ANN}'), ('${BO}'), ('${CY}'), ('${TEAMMATE}');
  insert into public.groups values ('${G_ANN}', 'one_on_one', 'aaaaaaaa-0000-0000-0000-000000000000'), ('${G_BO}', 'one_on_one', 'aaaaaaaa-0000-0000-0000-000000000000'),
    ('${G_CY}', 'one_on_one', 'aaaaaaaa-0000-0000-0000-000000000000'), ('${G_TEAM}', 'team', 'aaaaaaaa-0000-0000-0000-000000000000');
  insert into public.organization_admins values ('aaaaaaaa-0000-0000-0000-000000000000', '${OWNER}');
  insert into public.group_memberships (group_id, profile_id, role, joined_at, private_from_org) values
    ('${G_ANN}', '${COACH}', 'coach', now() - interval '400 days', false), ('${G_ANN}', '${ANN}', 'athlete', now() - interval '400 days', false),
    ('${G_BO}', '${COACH}', 'coach', now() - interval '200 days', false), ('${G_BO}', '${BO}', 'athlete', now() - interval '200 days', true),
    ('${G_CY}', '${COACH}', 'coach', now() - interval '300 days', false),
    ('${G_TEAM}', '${COACH}', 'coach', now() - interval '300 days', false), ('${G_TEAM}', '${TEAMMATE}', 'athlete', now() - interval '300 days', false);
  insert into public.client_removals (group_id, athlete_id, membership, removed_at) values ('${G_CY}', '${CY}', jsonb_build_object('joined_at', now() - interval '300 days', 'private_from_org', false), now() - interval '60 days');
  insert into public.workout_logs (group_id, athlete_id, created_at) values ('${G_ANN}', '${ANN}', now() - interval '20 days'), ('${G_CY}', '${CY}', now() - interval '90 days'), ('${G_TEAM}', '${TEAMMATE}', now());
  insert into public.bookings (group_id, athlete_id, start_at, status) values ('${G_ANN}', '${ANN}', now() - interval '2 days', 'confirmed'), ('${G_ANN}', '${ANN}', now() + interval '5 days', 'confirmed'),
    ('${G_ANN}', '${ANN}', now() - interval '1 day', 'cancelled');
`);

// ---- 2. how long one-on-one clients stay ----
const tenure = async (who) => {
  await as(who);
  return (await db.query(`select athlete_id, extract(day from now() - last_active)::int as last_days, removed_at is not null as removed from public.business_client_tenure($1)`, [[G_ANN, G_BO, G_CY, G_TEAM]])).rows;
};
let t = await tenure(COACH);
assert.deepEqual(t.map((r) => r.athlete_id).sort(), [ANN, BO, CY].sort(), "the coach: their one-on-one clients, the removed one too, never the team");
assert.equal(t.find((r) => r.athlete_id === ANN).last_days, 2, "last active: the latest workout or past session (a future or cancelled session does not count)");
assert.equal(t.find((r) => r.athlete_id === CY).removed, true);
assert.equal(t.find((r) => r.athlete_id === BO).last_days, null);
t = await tenure(OWNER);
assert.deepEqual(t.map((r) => r.athlete_id).sort(), [ANN, CY].sort(), "the owner: the organization's, except the client private from it");
assert.deepEqual(await tenure(OTHER_COACH), [], "another coach: nothing");
assert.deepEqual(await tenure(null), [], "signed out: nothing");

// ---- 1. a copy keeps a header ----
await as(COACH);
const prog = await one(`insert into public.programs (group_id, name, athlete_id, is_active) values ($1, 'Ann 12 weeks', $2, true) returning id`, [G_ANN, ANN]);
const wk = [];
for (const w of [1, 2, 3, 4]) wk.push((await one(`insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Lower', $3, 0) returning id`, [prog.id, G_ANN, w])).id);
// a second day in week 2, which never changes
const otherDay = (await one(`insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Upper', 2, 1) returning id`, [prog.id, G_ANN])).id;
const ex = async (workout, name, order, slot = "") =>
  (await one(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, progression_slot, athlete_id) values ($1, $2, $3, $4, $5, $6) returning id`, [workout, G_ANN, name, order, slot, ANN])).id;
const w1Squat = await ex(wk[0], "Leg Press", 1);
await ex(wk[0], "Bench Press", 2);
const w2Squat = await ex(wk[1], "Leg Press", 1);
await ex(wk[1], "Bench Press", 2);
const w3Diff = await ex(wk[2], "Hack Squat", 1); // the slot holds something else in week 3: left alone
await ex(wk[2], "Leg Press", 2); // the same exercise in a different place: left alone
const w4Squat = await ex(wk[3], "Leg Press", 1);
const otherDayPress = await ex(otherDay, "Leg Press", 1); // another day of the week: left alone
await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps, target_weight, set_type, target_pct_max) values ($1, 0, '8', 300, 'working', null), ($2, 0, '6', null, 'amrap', 75)`, [w2Squat, w4Squat]);
await db.query(`insert into public.workout_notes (workout_id, group_id, body, position, created_by, is_header) values ($1, $2, 'Strength', 0, $3, true), ($1, $2, 'Go easy today', 3, $3, false)`, [wk[0], G_ANN, COACH]);
const copy = await one(`select public.duplicate_program($1, $2, $3) as id`, [prog.id, G_ANN, COACH]);
const copiedNotes = (await db.query(`select n.body, n.is_header from public.workout_notes n join public.workouts w on w.id = n.workout_id where w.program_id = $1 order by n.position`, [copy.id])).rows;
assert.deepEqual(copiedNotes, [{ body: "Strength", is_header: true }, { body: "Go easy today", is_header: false }]);
// (these tables have no foreign keys here, so the copy is cleared by hand)
await db.query(`delete from public.workout_notes where workout_id in (select id from public.workouts where program_id = $1)`, [copy.id]);
await db.query(`delete from public.workouts where program_id = $1`, [copy.id]);
await db.query(`delete from public.programs where id = $1`, [copy.id]);

// ---- 3. every week from here on ----
const name = async (id) => (await one(`select exercise_name from public.group_workout_exercises where id = $1`, [id])).exercise_name;
const swap = async (id, to, dry = false) => (await one(`select public.swap_exercise_every_week($1, $2, null, $3) as r`, [id, to, dry])).r;
await db.query(`insert into public.exercise_progressions (program_id, group_id, exercise_name, model, config, created_by, slot) values ($1, $2, 'Leg Press', 'linear', '{"step": 10}', $3, '')`, [prog.id, G_ANN, COACH]);

// a dry run says how many later weeks would change and writes nothing
let r = await swap(w2Squat, "Hack Squat", true);
assert.equal(r.changed, 1);
assert.deepEqual(r.weeks, [4]);
assert.equal(await name(w2Squat), "Leg Press");
assert.equal((await one(`select count(*)::int n from public.program_exercise_swaps`)).n, 0);

// the coach, from week 2: week 2 and week 4 change; week 1 (earlier), week 3 (a different exercise in the slot), and another day do not
r = await swap(w2Squat, "Hack Squat");
assert.equal(r.changed, 1);
assert.equal(r.byClient, false);
assert.deepEqual([await name(w1Squat), await name(w2Squat), await name(w3Diff), await name(w4Squat), await name(otherDayPress)], ["Leg Press", "Hack Squat", "Hack Squat", "Hack Squat", "Leg Press"]);
assert.equal((await one(`select count(*)::int n from public.group_workout_exercises where workout_id = $1 and exercise_name = 'Leg Press'`, [wk[2]])).n, 1, "week 3's Leg Press in another place is left alone");
// each week keeps its own sets
assert.deepEqual((await db.query(`select target_reps, target_weight::int w, set_type, target_pct_max::int p from public.group_workout_exercise_sets where group_workout_exercise_id = $1`, [w4Squat])).rows, [{ target_reps: "6", w: null, set_type: "amrap", p: 75 }]);
// week 1 still uses Leg Press, so its rule stays and Hack Squat gets a copy
assert.deepEqual((await db.query(`select exercise_name, config from public.exercise_progressions where program_id = $1 order by exercise_name`, [prog.id])).rows, [
  { exercise_name: "Hack Squat", config: { step: 10 } },
  { exercise_name: "Leg Press", config: { step: 10 } },
]);
const coachSwap = r.swap;

// the undo puts back exactly what it changed; a row changed since is left alone; the copied rule goes
await db.query(`update public.group_workout_exercises set exercise_name = 'Belt Squat' where id = $1`, [w4Squat]);
await as(ANN);
await assert.rejects(() => db.query(`select public.undo_exercise_swap($1)`, [coachSwap]), /not authorized/, "only the coach undoes");
await as(COACH);
assert.equal((await one(`select public.undo_exercise_swap($1) as n`, [coachSwap])).n, 1);
assert.deepEqual([await name(w2Squat), await name(w4Squat)], ["Leg Press", "Belt Squat"]);
assert.deepEqual((await db.query(`select exercise_name from public.exercise_progressions where program_id = $1`, [prog.id])).rows, [{ exercise_name: "Leg Press" }]);
assert.equal((await one(`select public.undo_exercise_swap($1) as n`, [coachSwap])).n, 0, "a second undo does nothing");
await db.query(`update public.group_workout_exercises set exercise_name = 'Leg Press' where id = $1`, [w4Squat]);

// the client on their own one-on-one program, from week 1: every later Leg Press in that place changes, and the rule moves (no week keeps the old name in that place)
await as(ANN);
r = await swap(w1Squat, "Hack Squat");
assert.equal(r.byClient, true);
assert.equal(r.changed, 2);
assert.deepEqual([await name(w1Squat), await name(w2Squat), await name(w4Squat)], ["Hack Squat", "Hack Squat", "Hack Squat"]);
// week 3's Leg Press (another place) still uses the old name, so the rule is copied, not moved
assert.deepEqual((await db.query(`select exercise_name from public.exercise_progressions where program_id = $1 order by 1`, [prog.id])).rows.map((x) => x.exercise_name), ["Hack Squat", "Leg Press"]);
assert.equal((await one(`select by_client, from_name, to_name, jsonb_array_length(changes) n from public.program_exercise_swaps where id = $1`, [r.swap])).n, 3);
const clientSwap = r.swap;
await as(COACH);
assert.equal((await one(`select public.undo_exercise_swap($1) as n`, [clientSwap])).n, 3);
assert.deepEqual([await name(w1Squat), await name(w2Squat), await name(w4Squat)], ["Leg Press", "Leg Press", "Leg Press"]);

// by progression slot: a T1 lift is matched by its slot, wherever it sits in the day
const t1a = await ex(wk[0], "Deadlift", 5, "T1");
const t1b = await ex(wk[1], "Deadlift", 9, "T1");
const t1c = await ex(wk[1], "Deadlift", 3, "T2");
r = await swap(t1a, "Trap Bar Deadlift");
assert.equal(r.changed, 1);
assert.deepEqual([await name(t1b), await name(t1c)], ["Trap Bar Deadlift", "Deadlift"]);

// refused: a client on a team program, another coach, a stranger, signed out
const team = await one(`insert into public.programs (group_id, name, is_active) values ($1, 'Team', true) returning id`, [G_TEAM]);
const tw = await one(`insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day', 1, 0) returning id`, [team.id, G_TEAM]);
const teamEx = (await one(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Squat', 1) returning id`, [tw.id, G_TEAM])).id;
await as(TEAMMATE);
await assert.rejects(() => swap(teamEx, "Leg Press"), /not authorized/);
for (const who of [OTHER_COACH, BO, null]) {
  await as(who);
  await assert.rejects(() => swap(w1Squat, "Hack Squat"), /not authorized/);
}
await as(COACH);
await assert.rejects(() => swap(w1Squat, "  "), /an exercise name is needed/);
assert.equal((await swap(w1Squat, "Leg Press")).changed, 0, "the same name changes nothing");

// ---- 4. the notice type ----
await db.query(`insert into public.notifications (profile_id, group_id, type, body) values ($1, $2, 'exercise_swap', 'Ann swapped Leg Press for Hack Squat for every week')`, [COACH, G_ANN]);
await assert.rejects(() => db.query(`insert into public.notifications (profile_id, type, body) values ($1, 'nonsense', 'x')`, [COACH]));
assert.equal((await one(`select public.notice_kind_of('exercise_swap') k`)).k, "client_activity");

// ---- the undo ----
await db.exec(undo);
assert.equal(await bodyMd5("duplicate_program"), LIVE.duplicate_program, "duplicate_program is live again");
assert.equal(await bodyMd5("notice_kind_of"), LIVE.notice_kind_of, "notice_kind_of is live again");
assert.equal((await one(`select to_regclass('public.program_exercise_swaps') is null and to_regprocedure('public.business_client_tenure(uuid[])') is null and to_regprocedure('public.swap_exercise_every_week(uuid, text, text, boolean)') is null as gone`)).gone, true);
assert.equal((await one(`select count(*)::int n from information_schema.columns where table_name = 'workout_notes' and column_name = 'is_header'`)).n, 0);
assert.equal((await one(`select count(*)::int n from public.workout_notes where body = 'Strength'`)).n, 1, "a header's words are kept as a note");
await assert.rejects(() => db.query(`insert into public.notifications (profile_id, type, body) values ($1, 'exercise_swap', 'x')`, [COACH]));
await db.query(`insert into public.notifications (profile_id, type, body) values ($1, 'weekly_checkin', 'x')`, [COACH]);
await db.exec(undo); // a second undo is harmless
// and the paste applies again
await db.exec(paste);
assert.ok(Object.values(await checkRow()).every((v) => v === true));

console.log("wave 3 builder and clients (step 219): ok");
