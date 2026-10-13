// The paste-ready SQL files Ron runs by hand, applied in the order he runs them against the live-equivalent schema: every precheck must be all true
// before its apply file, the apply file must succeed, and a precheck run again afterwards must say the step is already applied.
//   node scripts/sql-tests/paste-files.test.mjs   (also part of npm run test:sql)
import { readFileSync } from "node:fs";
import { createDb, applyLiveEquivalent } from "./harness.mjs";
import { undoSql as functionAclOpenSql, TRIGGER_SWEEP } from "../function-acl.mjs";

const read = (f) => readFileSync(new URL(`../../supabase/${f}`, import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).replace(/create extension[^;]*;/gi, "");
const db = await createDb();
await applyLiveEquivalent(db);
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
// After an error the editor's transaction is left aborted until "rollback;" (the headers tell Ron to run it), so the test does the same.
const run = async (file) => { try { await db.exec(read(file)); return null; } catch (e) { await db.exec("rollback").catch(() => {}); return e.message.split("\n")[0]; } };
const pre = async (file) => (await db.query(read(file))).rows;

// ---- what Ron has already applied ----
const p48 = await pre("apply-0248-precheck.sql");
check("apply-0248-precheck: all true", p48.length === 6 && p48.every((r) => r.ok));
let e = await run("apply-now-0264-0265-0266-0253.sql");
check("apply-now-0264-0265-0266-0253.sql applies" + (e ? `: ${e}` : ""), !e);
e = await run("apply-0248.sql");
check("apply-0248.sql applies" + (e ? `: ${e}` : ""), !e);
const p67 = await pre("apply-0267-precheck.sql");
check("apply-0267-precheck: all true", p67.length === 5 && p67.every((r) => r.ok));
e = await run("apply-0267.sql");
check("apply-0267.sql applies" + (e ? `: ${e}` : ""), !e);

// A plain-text kiosk PIN exists before step 06, so step 07's data check has something to prove.
await db.exec(`
  insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'pin.coach@example.com'), ('00000000-0000-4000-8000-0000000000a2', 'pin.athlete@example.com');
  insert into public.profiles (id, full_name) values ('00000000-0000-4000-8000-0000000000a1', 'Pin Coach'), ('00000000-0000-4000-8000-0000000000a2', 'Pin Athlete');
  insert into public.organizations (slug, name, owner_id) values ('pin-org', 'Pin org', '00000000-0000-4000-8000-0000000000a1');
  insert into public.groups (id, name, created_by, organization_id) select '00000000-0000-4000-8000-0000000000b1', 'Pin group', '00000000-0000-4000-8000-0000000000a1', id from public.organizations where slug = 'pin-org';
  insert into public.group_memberships (group_id, profile_id, role, kiosk_pin) values
    ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'coach', null),
    ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', 'athlete', '4821');
`);

const before64 = { snap: null };
const before111 = { snap: null, other: null };
const RON64 = "136394ed-f108-4283-bcb7-310a1ac6cbc8";
const OTHER64 = "00000000-0000-4000-8000-0000000000f1";
const G164 = "64000000-0000-4000-8000-000000000001";
const snapshot64 = async () =>
  JSON.stringify(
    (
      await db.query(`select
        (select coalesce(json_agg(json_build_array(created_by, name, youtube_url, category) order by created_by, name), '[]') from public.exercise_library where created_by in ('${RON64}', '${OTHER64}')) as lib,
        (select coalesce(json_agg(json_build_array(id, exercise_name) order by id), '[]') from public.group_workout_exercises where group_id in ('${G164}', '64000000-0000-4000-8000-000000000002')) as gwe,
        (select coalesce(json_agg(json_build_array(id, exercise_name) order by id), '[]') from public.session_exercises) as se,
        (select coalesce(json_agg(json_build_array(coach_id, raw_name, exercise_name) order by coach_id, raw_name), '[]') from public.exercise_aliases) as al,
        (select coalesce(json_agg(json_build_array(id, exercise_name, config) order by id), '[]') from public.exercise_progressions) as pr,
        (select coalesce(json_agg(json_build_array(id, exercise_name, difficulty_rank) order by id), '[]') from public.movement_pattern_exercises) as mp,
        (select coalesce(json_agg(json_build_array(id, shared_exercise_names) order by id), '[]') from public.posts where group_id = '${G164}') as po,
        (select coalesce(json_agg(json_build_array(athlete_id, exercise_name) order by athlete_id, exercise_name), '[]') from public.athlete_training_maxes) as tm,
        (select coalesce(json_agg(json_build_array(id, exercise_name) order by id), '[]') from public.exercise_records) as rec,
        (select coalesce(json_agg(json_build_array(id, exercise_name_a, exercise_name_b) order by id), '[]') from public.athlete_equipment_load_ratios) as lr,
        (select coalesce(json_agg(json_build_array(id, exercise_name) order by id), '[]') from public.game_score_entries) as gs,
        (select count(*)::int from public.group_workout_exercise_sets) as sets`)
    ).rows[0]
  );

// ---- the numbered steps ----
const steps = JSON.parse(readFileSync(new URL("../../supabase/apply/steps.json", import.meta.url), "utf8"));
for (const s of steps) {
  // Live today: step 13 was applied before it was fixed, so the internal functions are open to signed-in users. Reproduce that before step 24.
  if (s.n === "24") await db.exec(functionAclOpenSql());
  if (s.n === "26") {
    // The Home Team move names real ids: build the same shape (a coach who owns both organizations and coaches the group) so every row is exercised.
    await db.exec(`
      insert into public.organizations (id, slug, name, owner_id) values
        ('b7318b19-a17e-4412-88f1-51d68fcf026f', 'ht-old', 'Enduring Strength Co.', '00000000-0000-4000-8000-0000000000a1'),
        ('e369f4a7-c53a-4532-95d3-f7bd14e40e48', 'ht-new', 'Coast2Coast Fitness', '00000000-0000-4000-8000-0000000000a1')
      on conflict (id) do nothing;
      insert into public.organization_memberships (organization_id, profile_id, role) values
        ('e369f4a7-c53a-4532-95d3-f7bd14e40e48', '00000000-0000-4000-8000-0000000000a1', 'owner')
      on conflict (organization_id, profile_id) do nothing;
      insert into public.groups (id, name, created_by, organization_id) values
        ('060017b5-e613-4204-a101-c6a14c3a9630', 'The Home Team', '00000000-0000-4000-8000-0000000000a1', 'b7318b19-a17e-4412-88f1-51d68fcf026f');
      insert into public.group_memberships (group_id, profile_id, role) values
        ('060017b5-e613-4204-a101-c6a14c3a9630', '00000000-0000-4000-8000-0000000000a1', 'coach');
      insert into public.programs (group_id, name, created_by) values ('060017b5-e613-4204-a101-c6a14c3a9630', 'Home Team program', '00000000-0000-4000-8000-0000000000a1');
    `);
  }
  if (s.n === "30") {
    // Main Group (with the 66-workout program, here a few workouts) and the stray Coast to Coast group, same ids as live.
    await db.exec(`
      insert into auth.users (id, email) values ('136394ed-f108-4283-bcb7-310a1ac6cbc8', 'ron.cleanup@example.com') on conflict (id) do nothing;
      insert into public.profiles (id, full_name) values ('136394ed-f108-4283-bcb7-310a1ac6cbc8', 'Coach Ron') on conflict (id) do nothing;
      insert into public.groups (id, name, created_by, organization_id) values
        ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'Main Group', '00000000-0000-4000-8000-0000000000a1', 'e369f4a7-c53a-4532-95d3-f7bd14e40e48'),
        ('c368ab0b-ccab-442e-a42e-38fb22293182', 'Coast to Coast', '00000000-0000-4000-8000-0000000000a1', 'b7318b19-a17e-4412-88f1-51d68fcf026f');
      insert into public.group_memberships (group_id, profile_id, role) values
        ('b292055b-edc6-4171-ad2b-a89d65dcd8db', '00000000-0000-4000-8000-0000000000a1', 'coach'),
        ('c368ab0b-ccab-442e-a42e-38fb22293182', '00000000-0000-4000-8000-0000000000a1', 'coach');
      insert into public.programs (id, group_id, name, created_by, is_active) values
        ('5b8a8a3a-344d-4192-a892-f74494fff9ab', 'b292055b-edc6-4171-ad2b-a89d65dcd8db', 'christmas_abs_program', '00000000-0000-4000-8000-0000000000a1', true),
        ('614a8eca-f629-41aa-b13d-85b20bf5b39e', 'c368ab0b-ccab-442e-a42e-38fb22293182', '4-Week Team Strength Program', '00000000-0000-4000-8000-0000000000a1', false);
      insert into public.workouts (id, program_id, group_id, title, week_number, day_index) values
        ('00000000-0000-4000-8000-0000000c0001', '5b8a8a3a-344d-4192-a892-f74494fff9ab', 'b292055b-edc6-4171-ad2b-a89d65dcd8db', 'Abs 1', 1, 1),
        ('00000000-0000-4000-8000-0000000c0002', '5b8a8a3a-344d-4192-a892-f74494fff9ab', 'b292055b-edc6-4171-ad2b-a89d65dcd8db', 'Abs 2', 1, 2),
        ('00000000-0000-4000-8000-0000000c0003', '614a8eca-f629-41aa-b13d-85b20bf5b39e', 'c368ab0b-ccab-442e-a42e-38fb22293182', 'Strength 1', 1, 1);
      insert into public.group_workout_exercises (id, workout_id, group_id, exercise_name, exercise_order, tracked_fields) values
        ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-0000000c0001', 'b292055b-edc6-4171-ad2b-a89d65dcd8db', 'Plank', 1, array['time']),
        ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000000c0002', 'b292055b-edc6-4171-ad2b-a89d65dcd8db', 'Hanging Leg Raise', 1, array['reps']),
        ('00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-0000000c0003', 'c368ab0b-ccab-442e-a42e-38fb22293182', 'Back Squat', 1, array['reps', 'weight']);
      insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values
        ('00000000-0000-4000-8000-0000000d0001', 1, '30'), ('00000000-0000-4000-8000-0000000d0001', 2, '30'),
        ('00000000-0000-4000-8000-0000000d0002', 1, '12'), ('00000000-0000-4000-8000-0000000d0003', 1, '5');
    `);
  }
  if (s.n === "31") {
    const copy = (await db.query(read("apply/check-copy-result.sql"))).rows;
    check("check-copy-result.sql shows the original and the copy with the same counts" + " (" + JSON.stringify(copy) + ")", copy.length === 2 && ["workouts", "exercises", "sets", "notes", "progressions"].every((k) => String(copy[0][k]) === String(copy[1][k])));
    // A client in Main Group, or a logged workout, must stop the delete; take them away again for the real run.
    await db.exec("insert into public.group_memberships (group_id, profile_id, role) values ('b292055b-edc6-4171-ad2b-a89d65dcd8db', '00000000-0000-4000-8000-0000000000a2', 'athlete')");
    const refused = await run("apply/apply-step31-delete-two-groups.sql");
    check("step 31 refuses while a group has a client (" + refused + ")", !!refused && /has a client/.test(refused));
    await db.exec("delete from public.group_memberships where group_id = 'b292055b-edc6-4171-ad2b-a89d65dcd8db' and role = 'athlete'");
    const still = (await db.query("select count(*)::int as n from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')")).rows[0].n;
    check("a refused step 31 deleted nothing", still === 2);
  }
  if (s.n === "23") {
    // The probe: applies 0281 inside a transaction, tries the four cases, and ends with an intentional error that carries the answer and rolls everything back.
    // The probe only ever uses the standing Test Sandbox group: build one with a coach and a client.
    await db.exec(`
      insert into public.groups (id, name, created_by, organization_id) select '50000000-0000-0000-0000-000000000002', 'Test Sandbox Group', '00000000-0000-4000-8000-0000000000a1', id from public.organizations where slug = 'pin-org';
      insert into public.group_memberships (group_id, profile_id, role) values
        ('50000000-0000-0000-0000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'coach'),
        ('50000000-0000-0000-0000-000000000002', '00000000-0000-4000-8000-0000000000a2', 'athlete');
    `);
    const probe = await run("apply/check-step23-probe.sql");
    check("check-step23-probe.sql answers: " + probe, !!probe && /PROBE RESULT/.test(probe) && /server booking was made and left them set aside: true/.test(probe) && /client message brought them back: true/.test(probe) && /coach message left them set aside: true/.test(probe) && /ordinary booking brought them back: true/.test(probe) && !/error:/.test(probe));
    const gone = (await db.query("select to_regclass('public.client_inactive') as t")).rows[0].t;
    check("check-step23-probe.sql leaves nothing behind (0281 itself was rolled back)", gone === null);
  }
  if (s.n === "64") {
    // Coach Ron's library with the 13 duplicates and 12 survivors (the real names), his group and client, and every kind of place a name is stored; plus another coach with the same names who must not be touched.
    const RON = "136394ed-f108-4283-bcb7-310a1ac6cbc8";
    const OTHER = "00000000-0000-4000-8000-0000000000f1";
    const G1 = "64000000-0000-4000-8000-000000000001";
    const G2 = "64000000-0000-4000-8000-000000000002";
    const ATH = "00000000-0000-4000-8000-0000000000a2";
    const losers = ["Deadlift", "Conventional Deadlifts", "Band Pull-Apart", "Chin Ups", "Dips", "Dumbbell Lateral Raises", "Farmer's Carry", "Lat Pull Down", "Shoulder CARS", "Sit Ups", "Step Ups", "Bulgarian Split Squats", "Walking Lunges"];
    const survivors = ["Conventional Deadlift", "Band Pull Apart", "Chin-Up", "Dip", "Dumbbell Lateral Raise", "Farmers Carry", "Lat Pulldown", "Shoulder CARs", "Sit-Up", "Step Up", "Bulgarian Split Squat", "Walking Lunge"];
    const noVideo = new Set(["Bulgarian Split Squat", "Walking Lunge"]);
    const q = (n) => "'" + n.replace(/'/g, "''") + "'";
    await db.exec(`
      insert into auth.users (id, email) values ('${OTHER}', 'other.coach.merge@example.com') on conflict (id) do nothing;
      insert into public.profiles (id, full_name) values ('${RON}', 'Coach Ron') on conflict (id) do nothing;
      insert into public.profiles (id, full_name) values ('${OTHER}', 'Other Coach') on conflict (id) do nothing;
      insert into public.groups (id, name, created_by, organization_id) values
        ('${G1}', 'Merge Ron group', '${RON}', 'b7318b19-a17e-4412-88f1-51d68fcf026f'),
        ('${G2}', 'Merge Other group', '${OTHER}', 'b7318b19-a17e-4412-88f1-51d68fcf026f');
      insert into public.group_memberships (group_id, profile_id, role) values
        ('${G1}', '${RON}', 'coach'), ('${G1}', '${ATH}', 'athlete'), ('${G2}', '${OTHER}', 'coach');
      insert into public.exercise_library (created_by, name, youtube_url, category) values
        ${losers.map((n) => "('" + RON + "', " + q(n) + ", null, null)").join(", ")},
        ${survivors.map((n) => "('" + RON + "', " + q(n) + ", " + (noVideo.has(n) ? "null" : "'https://youtube.example/" + n.replace(/[^A-Za-z]/g, "") + "'") + ", 'Legs')").join(", ")},
        ('${OTHER}', 'Deadlift', null, 'Pull'), ('${OTHER}', 'Dips', null, null);
      insert into public.programs (id, group_id, name, created_by) values
        ('64000000-0000-4000-8000-0000000000a1', '${G1}', 'Merge Ron program', '${RON}'),
        ('64000000-0000-4000-8000-0000000000a2', '${G2}', 'Merge Other program', '${OTHER}');
      insert into public.workouts (id, program_id, group_id, title, week_number, day_index) values
        ('64000000-0000-4000-8000-0000000000b1', '64000000-0000-4000-8000-0000000000a1', '${G1}', 'Day 1', 1, 1),
        ('64000000-0000-4000-8000-0000000000b2', '64000000-0000-4000-8000-0000000000a2', '${G2}', 'Day 1', 1, 1);
      insert into public.group_workout_exercises (id, workout_id, group_id, exercise_name, exercise_order, tracked_fields) values
        ('64000000-0000-4000-8000-0000000000c1', '64000000-0000-4000-8000-0000000000b1', '${G1}', 'Deadlift', 1, array['reps']),
        ('64000000-0000-4000-8000-0000000000c2', '64000000-0000-4000-8000-0000000000b1', '${G1}', 'Deadlift', 2, array['reps']),
        ('64000000-0000-4000-8000-0000000000c3', '64000000-0000-4000-8000-0000000000b1', '${G1}', 'Conventional Deadlifts', 3, array['reps']),
        ('64000000-0000-4000-8000-0000000000c4', '64000000-0000-4000-8000-0000000000b1', '${G1}', 'Dips', 4, array['reps']),
        ('64000000-0000-4000-8000-0000000000c5', '64000000-0000-4000-8000-0000000000b1', '${G1}', 'Back Squat', 5, array['reps']),
        ('64000000-0000-4000-8000-0000000000c6', '64000000-0000-4000-8000-0000000000b2', '${G2}', 'Deadlift', 1, array['reps']);
      insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values
        ('64000000-0000-4000-8000-0000000000c1', 1, '5'), ('64000000-0000-4000-8000-0000000000c1', 2, '5'), ('64000000-0000-4000-8000-0000000000c4', 1, '8');
      insert into public.athlete_sessions (id, workout_id, group_id, athlete_id, status) values
        ('64000000-0000-4000-8000-0000000000d1', '64000000-0000-4000-8000-0000000000b1', '${G1}', '${ATH}', 'in_progress');
      insert into public.session_exercises (session_id, exercise_name, exercise_order) values
        ('64000000-0000-4000-8000-0000000000d1', 'Dips', 1), ('64000000-0000-4000-8000-0000000000d1', 'Back Squat', 2);
      insert into public.exercise_aliases (coach_id, raw_name, exercise_name) values ('${RON}', 'dl', 'Deadlift'), ('${OTHER}', 'dl', 'Deadlift');
      insert into public.exercise_progressions (program_id, group_id, exercise_name, model, config, created_by) values
        ('64000000-0000-4000-8000-0000000000a1', '${G1}', 'Deadlift', 'linear', '{"loser": true}', '${RON}'),
        ('64000000-0000-4000-8000-0000000000a1', '${G1}', 'Conventional Deadlift', 'linear', '{"survivor": true}', '${RON}'),
        ('64000000-0000-4000-8000-0000000000a1', '${G1}', 'Dips', 'linear', '{"only": true}', '${RON}');
      insert into public.movement_patterns (id, created_by, name) values ('64000000-0000-4000-8000-0000000000e1', '${RON}', 'Hinge');
      insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank) values
        ('64000000-0000-4000-8000-0000000000e1', 'Deadlift', 1), ('64000000-0000-4000-8000-0000000000e1', 'Conventional Deadlift', 2), ('64000000-0000-4000-8000-0000000000e1', 'Step Ups', 3);
      insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, achieved_at) values
        ('${G1}', 'Dips', 'reps', 'higher_better', 10, '${ATH}', now());
      insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe) values ('${ATH}', 'Dips', 100, 80, 5, 8);
      insert into public.athlete_equipment_load_ratios (athlete_id, exercise_name_a, exercise_name_b, ratio, sample_count) values ('${ATH}', 'Dips', 'Back Squat', 0.5, 3), ('${ATH}', 'Back Squat', 'Step Ups', 0.7, 2);
      insert into public.game_score_entries (group_id, exercise_name, athlete_id, points, logged_by) values ('${G1}', 'Dips', '${ATH}', 5, '${RON}');
      insert into public.posts (group_id, author_id, post_type, body, shared_exercise_names) values ('${G1}', '${RON}', 'user_post', 'x', array['Dips', 'Back Squat']);
    `);
    before64.snap = await snapshot64();
  }
  if (s.n === "105") {
    // Coach Ron's own training in The Enduring Strength Collective: one program to move, one he removed first (stays), their workouts and lines, a session, its log, a wellness check-in,
    // a session in another person's space (stays), and his personal space (made by his first click on Coach Ron (you)).
    await db.exec(`
      insert into public.organizations (id, slug, name, owner_id) values ('b0000000-0000-4000-8000-000000000001', 'bk-esc', 'Enduring Strength Co. (test)', '00000000-0000-4000-8000-0000000000a1') on conflict (id) do nothing;
      insert into public.groups (id, name, created_by, organization_id) values
        ('b0000000-0000-4000-8000-0000000000e1', 'The Enduring Strength Collective', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'b0000000-0000-4000-8000-000000000001'),
        ('b0000000-0000-4000-8000-0000000000e2', 'Karina Ramirez', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'b0000000-0000-4000-8000-000000000001');
      insert into public.group_memberships (group_id, profile_id, role) values
        ('b0000000-0000-4000-8000-0000000000e1', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'coach'),
        ('b0000000-0000-4000-8000-0000000000e2', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'coach');
      insert into public.groups (id, name, created_by, organization_id, group_kind) values ('b0000000-0000-4000-8000-0000000000f1', 'Coach Ron', '136394ed-f108-4283-bcb7-310a1ac6cbc8', null, 'one_on_one');
      insert into public.group_memberships (group_id, profile_id, role) values ('b0000000-0000-4000-8000-0000000000f1', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'coach');
      insert into public.programs (id, group_id, name, created_by, athlete_id, is_active, archived_at) values
        ('b0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000e1', 'christmas_abs_program', '136394ed-f108-4283-bcb7-310a1ac6cbc8', '136394ed-f108-4283-bcb7-310a1ac6cbc8', true, null),
        ('b0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000e1', 'Jeff Z', '136394ed-f108-4283-bcb7-310a1ac6cbc8', '136394ed-f108-4283-bcb7-310a1ac6cbc8', false, now());
      insert into public.workouts (id, program_id, group_id, athlete_id, title, week_number, day_index) values
        ('b0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000e1', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'Day 1', 1, 1),
        ('b0000000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000e1', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'Day 1', 1, 1);
      insert into public.group_workout_exercises (id, workout_id, group_id, athlete_id, exercise_name, exercise_order, tracked_fields) values
        ('b0000000-0000-4000-8000-0000000000c1', 'b0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000e1', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'Plank', 1, array['time']),
        ('b0000000-0000-4000-8000-0000000000c2', 'b0000000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-0000000000e1', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'Plank', 1, array['time']);
      insert into public.athlete_sessions (id, workout_id, group_id, athlete_id, status) values
        ('b0000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000e1', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'completed'),
        ('b0000000-0000-4000-8000-0000000000d2', null, 'b0000000-0000-4000-8000-0000000000e2', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'completed');
      insert into public.workout_logs (session_id, athlete_id, group_id, workout_id) values ('b0000000-0000-4000-8000-0000000000d1', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'b0000000-0000-4000-8000-0000000000e1', 'b0000000-0000-4000-8000-0000000000b1');
      insert into public.wellness_checkins (athlete_id, group_id, sleep_quality, soreness, energy) values ('136394ed-f108-4283-bcb7-310a1ac6cbc8', 'b0000000-0000-4000-8000-0000000000e1', 4, 2, 5);
    `);
  }
  if (s.n === "109") {
    // The two empty stray groups left by failed add-client attempts, with the same ids as live.
    await db.exec(`
      insert into public.groups (id, name, created_by, organization_id, group_kind) values
        ('e2425435-950a-409d-8d4e-e24d92f21652', 'Rob Derrick', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'b0000000-0000-4000-8000-000000000001', 'one_on_one'),
        ('568e84b6-b85c-476c-b160-7b6b64e21caa', 'Rob Derrick', '136394ed-f108-4283-bcb7-310a1ac6cbc8', 'b0000000-0000-4000-8000-000000000001', 'one_on_one');
    `);
  }
  if (s.n === "111") {
    // Coach Ron's library with the old names (plus the four FitPros ones from step 106), program lines, a session, a record, a client's two maxes (one per old name), aliases and a post that use them;
    // another coach with some of the same names whose library and programs must not change at all; and a name only that other coach has, which must never reach the shared catalog.
    const q = (n) => "'" + n.replace(/'/g, "''") + "'";
    const names = ["Back Squat", "Barbell Back Squats", "Front Squat", "Barbell Front Squats", "Leg Extension", "Leg Extension Machine", "Dumbbell Skull Crusher", "Dumbbell Tricep Skull Crushers", "Incline Dumbbell Bench Press", "Incline Dumbbell Press", "Single Arm Farmers Carry", "Suitcase Carry (Single Arm Farmers Carry)", "Kettlebell Swing", "Russian Kettlebell Swing", "Rear Foot Elevated Split Squat", "Dumbbell Rear Foot Elevated Split Squat", "Walking Lunge", "Dumbbell Walking Lunge", "Face Pull", "Cable Face Pulls", "Barbell Face Pull", "Romanian Deadlift", "Dumbbell Romanian Deadlift", "Reverse Lunge", "Barbell Reverse Lunge", "Split Squat", "Box Squat", "Lat Pulldown"];
    const videos = { "Back Squat": "https://youtube.example/BackSquat", "Russian Kettlebell Swing": "https://youtube.example/RussianSwing", "Dumbbell Walking Lunge": "https://youtube.example/DbWalkingLunge" };
    await db.exec(`
      insert into public.exercise_library (created_by, name, youtube_url, category) values
        ${names.map((n) => "('" + RON64 + "', " + q(n) + ", " + (videos[n] ? q(videos[n]) : "null") + ", 'Legs')").join(", ")}
      on conflict (created_by, name) do nothing;
      insert into public.exercise_library (created_by, name, youtube_url, category) values
        ('${OTHER64}', 'Back Squat', null, 'Legs'), ('${OTHER64}', 'Face Pull', null, null), ('${OTHER64}', 'Lat Pulldown', null, null), ('${OTHER64}', 'Other Coach Only Move', null, null);
      update public.exercise_library set youtube_url = 'https://youtube.example/BackSquat' where created_by = '${RON64}' and name = 'Back Squat' and youtube_url is null;
      insert into public.group_workout_exercises (id, workout_id, group_id, exercise_name, exercise_order, tracked_fields) values
        ('11100000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-0000000000b1', '${G164}', 'Barbell Back Squats', 11, array['reps']),
        ('11100000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-0000000000b1', '${G164}', 'Face Pull', 12, array['reps']),
        ('11100000-0000-4000-8000-000000000003', '64000000-0000-4000-8000-0000000000b1', '${G164}', 'Lat Pulldown', 13, array['reps']),
        ('11100000-0000-4000-8000-000000000004', '64000000-0000-4000-8000-0000000000b1', '${G164}', 'Cable Face Pulls', 14, array['reps']),
        ('11100000-0000-4000-8000-000000000005', '64000000-0000-4000-8000-0000000000b2', '64000000-0000-4000-8000-000000000002', 'Face Pull', 11, array['reps']),
        ('11100000-0000-4000-8000-000000000006', '64000000-0000-4000-8000-0000000000b2', '64000000-0000-4000-8000-000000000002', 'Lat Pulldown', 12, array['reps']);
      insert into public.session_exercises (session_id, exercise_name, exercise_order) values
        ('64000000-0000-4000-8000-0000000000d1', 'Barbell Back Squats', 3), ('64000000-0000-4000-8000-0000000000d1', 'Face Pull', 4);
      insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, achieved_at) values
        ('${G164}', 'Back Squat', 'weight', 'higher_better', 225, '00000000-0000-4000-8000-0000000000a2', now());
      insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe) values
        ('00000000-0000-4000-8000-0000000000a2', 'Back Squat', 200, 180, 5, 8), ('00000000-0000-4000-8000-0000000000a2', 'Barbell Back Squats', 250, 220, 5, 8), ('00000000-0000-4000-8000-0000000000a2', 'Face Pull', 50, 40, 10, 8);
      insert into public.exercise_aliases (coach_id, raw_name, exercise_name) values ('${RON64}', 'bs', 'Back Squat'), ('${OTHER64}', 'bs', 'Back Squat');
      insert into public.posts (group_id, author_id, post_type, body, shared_exercise_names) values ('${G164}', '${RON64}', 'user_post', 'y', array['Barbell Back Squats', 'Lat Pulldown']);
    `);
    before111.snap = await snapshot64();
    before111.other = JSON.stringify((await db.query(`select
      (select coalesce(json_agg(name order by name), '[]') from public.exercise_library where created_by = '${OTHER64}') as lib,
      (select coalesce(json_agg(exercise_name order by id), '[]') from public.group_workout_exercises where group_id = '64000000-0000-4000-8000-000000000002') as gwe`)).rows[0]);
  }
  const base = `apply/apply-step${s.n}-${s.slug}`;
  const rows = await pre(`${base}-precheck.sql`);
  const bad = rows.filter((r) => !r.ok).map((r) => r.check_name);
  check(`step ${s.n} (${s.slug}) precheck: ${rows.length} rows, all true` + (bad.length ? ` (FALSE: ${bad.join("; ")})` : ""), rows.length === s.rows && bad.length === 0);
  e = await run(`${base}.sql`);
  check(`step ${s.n} (${s.slug}) applies` + (e ? `: ${e}` : ""), !e);
  if (s.n === "109") {
    const gone = (await db.query("select count(*)::int as n from public.groups where id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')")).rows[0].n;
    const logged = (await db.query("select count(*)::int as n from public.orphan_group_cleanup_log")).rows[0].n;
    check("step 109 removed the two empty Rob Derrick groups and logged them: " + gone + " left, " + logged + " logged", gone === 0 && logged === 2);
  }
  if (s.n === "105") {
    const one = async (sql) => (await db.query(sql)).rows[0];
    const PS = "b0000000-0000-4000-8000-0000000000f1";
    const ESC = "b0000000-0000-4000-8000-0000000000e1";
    const moved = await one(`select
      (select count(*)::int from public.programs where group_id = '${PS}' and id = 'b0000000-0000-4000-8000-0000000000a1') as prog,
      (select count(*)::int from public.workouts where group_id = '${PS}' and id = 'b0000000-0000-4000-8000-0000000000b1') as wk,
      (select count(*)::int from public.group_workout_exercises where group_id = '${PS}' and id = 'b0000000-0000-4000-8000-0000000000c1') as line,
      (select count(*)::int from public.athlete_sessions where group_id = '${PS}' and id = 'b0000000-0000-4000-8000-0000000000d1') as sess,
      (select count(*)::int from public.workout_logs where group_id = '${PS}') as log,
      (select count(*)::int from public.wellness_checkins where group_id = '${PS}') as well,
      (select count(*)::int from public.programs where group_id = '${ESC}' and id = 'b0000000-0000-4000-8000-0000000000a2') as removed_stays,
      (select count(*)::int from public.workouts where group_id = '${ESC}' and id = 'b0000000-0000-4000-8000-0000000000b2') as removed_wk_stays,
      (select count(*)::int from public.athlete_sessions where group_id = 'b0000000-0000-4000-8000-0000000000e2' and id = 'b0000000-0000-4000-8000-0000000000d2') as other_space_session_stays`);
    check("step 105 moved the program, its workout and line, the session, the log and the wellness check-in into the personal space: " + JSON.stringify(moved), moved.prog === 1 && moved.wk === 1 && moved.line === 1 && moved.sess === 1 && moved.log === 1 && moved.well === 1);
    check("step 105 left the removed program, its workout and the session in another person's space where they were", moved.removed_stays === 1 && moved.removed_wk_stays === 1 && moved.other_space_session_stays === 1);
  }
  if (s.n === "111") {
    const one = async (sql) => (await db.query(sql)).rows[0];
    const ATH2 = "00000000-0000-4000-8000-0000000000a2";
    const a = await one(`select
      (select count(*)::int from public.exercise_library where created_by = '${RON64}' and name in ('Back Squat', 'Barbell Back Squats', 'Front Squat', 'Barbell Front Squats', 'Leg Extension Machine', 'Dumbbell Tricep Skull Crushers', 'Incline Dumbbell Press', 'Single Arm Farmers Carry', 'Suitcase Carry (Single Arm Farmers Carry)', 'Russian Kettlebell Swing', 'Rear Foot Elevated Split Squat', 'Walking Lunge', 'Face Pull', 'Cable Face Pulls', 'Romanian Deadlift', 'Reverse Lunge', 'Split Squat', 'Box Squat', 'Lat Pulldown')) as old_left,
      (select count(*)::int from public.exercise_library where created_by = '${RON64}' and name in ('Barbell Back Squat', 'Barbell Front Squat', 'Leg Extension', 'Dumbbell Skull Crusher', 'Incline Dumbbell Bench Press', 'Suitcase Carry', 'Kettlebell Swing', 'Dumbbell Rear Foot Elevated Split Squat', 'Dumbbell Walking Lunge', 'Banded Face Pull', 'Cable Face Pull', 'Barbell Face Pull', 'Barbell Romanian Deadlift', 'Dumbbell Romanian Deadlift', 'Dumbbell Reverse Lunge', 'Barbell Reverse Lunge', 'Dumbbell Split Squat', 'Barbell Box Squat', 'Cable Lat Pulldown')) as final_there,
      (select youtube_url from public.exercise_library where created_by = '${RON64}' and name = 'Barbell Back Squat') as bbs_video,
      (select youtube_url from public.exercise_library where created_by = '${RON64}' and name = 'Kettlebell Swing') as kb_video,
      (select youtube_url from public.exercise_library where created_by = '${RON64}' and name = 'Dumbbell Walking Lunge') as dwl_video,
      (select count(*)::int from public.group_workout_exercises where group_id = '${G164}' and exercise_name in ('Back Squat', 'Barbell Back Squats', 'Face Pull', 'Cable Face Pulls', 'Lat Pulldown')) as gwe_old,
      (select count(*)::int from public.group_workout_exercises where group_id = '${G164}' and exercise_name = 'Barbell Back Squat') as gwe_bbs,
      (select count(*)::int from public.group_workout_exercises where group_id = '${G164}' and exercise_name = 'Banded Face Pull') as gwe_banded,
      (select count(*)::int from public.group_workout_exercises where group_id = '${G164}' and exercise_name = 'Cable Face Pull') as gwe_cable,
      (select count(*)::int from public.session_exercises where session_id = '64000000-0000-4000-8000-0000000000d1' and exercise_name in ('Barbell Back Squat', 'Banded Face Pull')) as se_new,
      (select count(*)::int from public.exercise_records where group_id = '${G164}' and exercise_name = 'Barbell Back Squat') as rec_new,
      (select string_agg(exercise_name || ':' || estimated_max::int, ',' order by exercise_name) from public.athlete_training_maxes where athlete_id = '${ATH2}' and exercise_name in ('Back Squat', 'Barbell Back Squats', 'Barbell Back Squat', 'Face Pull', 'Banded Face Pull')) as maxes,
      (select string_agg(shared_exercise_names::text, '|') from public.posts where group_id = '${G164}' and body = 'y') as post_names,
      (select exercise_name from public.exercise_aliases where coach_id = '${RON64}' and raw_name = 'Back Squat') as alias_old_name,
      (select exercise_name from public.exercise_aliases where coach_id = '${RON64}' and raw_name = 'bs') as alias_bs,
      (select exercise_name from public.exercise_aliases where coach_id = '${RON64}' and raw_name = 'Face Pull') as alias_fp`);
    check("step 111: none of the old names is left in Ron's library, every final name is there once (merged-away entries gone, separate ones kept): " + a.old_left + " old, " + a.final_there + " final", a.old_left === 0 && a.final_there === 19);
    check("step 111: the merged entries keep a video (Back Squat's onto Barbell Back Squat, Russian Swing's onto Kettlebell Swing; an existing one is not replaced)", a.bbs_video === "https://youtube.example/BackSquat" && a.kb_video === "https://youtube.example/RussianSwing" && a.dwl_video === "https://youtube.example/DbWalkingLunge");
    check("step 111: Ron's program lines, session lines, record, post and client max carry the final names (" + JSON.stringify(a) + ")", a.gwe_old === 0 && a.gwe_bbs === 2 && a.gwe_banded === 1 && a.gwe_cable === 1 && a.se_new === 3 && a.rec_new === 1 && a.post_names === '{"Barbell Back Squat","Cable Lat Pulldown"}');
    check("step 111: a client with both old names keeps the higher max under the final name, and Face Pull's max follows its rename", a.maxes === "Banded Face Pull:50,Barbell Back Squat:250");
    check("step 111: the old names are saved as aliases of the final names, and Ron's own alias follows", a.alias_old_name === "Barbell Back Squat" && a.alias_bs === "Barbell Back Squat" && a.alias_fp === "Banded Face Pull");
    const other = JSON.stringify(await one(`select
      (select coalesce(json_agg(name order by name), '[]') from public.exercise_library where created_by = '${OTHER64}') as lib,
      (select coalesce(json_agg(exercise_name order by id), '[]') from public.group_workout_exercises where group_id = '64000000-0000-4000-8000-000000000002') as gwe`));
    check("step 111: the other coach's library and program lines are exactly as they were", other === before111.other);
    const cat = await one(`select
      (select count(*)::int from public.exercise_catalog) as n,
      (select count(distinct lower(name))::int from public.exercise_library where created_by = '${RON64}') as ron_distinct,
      (select count(*)::int from public.exercise_library where created_by = '${RON64}' and catalog_id is null) as unlinked,
      (select count(*)::int from public.exercise_catalog where name not in (select name from public.exercise_library where created_by = '${RON64}')) as strangers,
      (select count(*)::int from public.exercise_catalog where name = 'Other Coach Only Move') as leaked,
      (select count(*)::int from public.exercise_library where created_by = '${OTHER64}' and catalog_id is not null) as other_linked,
      (select c.name from public.exercise_catalog_aliases a join public.exercise_catalog c on c.id = a.catalog_id where a.alias_key = 'backsquat') as back_squat_alias,
      (select c.name from public.exercise_catalog_aliases a join public.exercise_catalog c on c.id = a.catalog_id where a.alias_key = 'sissysquats') as sissy_alias,
      (select count(*)::int from public.exercise_catalog where name in ('Sissy Squat', 'Thoracic Extension (Quadruped)', 'Handcuff W Rotation', 'Incline Iso Lateral Chest Press')) as fitpros`);
    check("step 111: the catalog holds one entry per exercise in Ron's library, every library row is linked, and old spellings point at the final entry (" + JSON.stringify(cat) + ")", cat.n === cat.ron_distinct && cat.unlinked === 0 && cat.back_squat_alias === "Barbell Back Squat" && cat.sissy_alias === "Sissy Squat" && cat.fitpros === 4);
    check("step 111: nothing of another coach reaches the catalog (names only from Ron's library; the other coach's own entries are not linked)", cat.strangers === 0 && cat.leaked === 0 && cat.other_linked === 0);
    // The undo returns every table to exactly what it was, and the step applies again with the same result.
    const afterSnap111 = await snapshot64();
    const eu111 = await run("apply/undo-step111-catalog-merge-ron.sql");
    const undone111 = await one("select (select count(*)::int from public.exercise_catalog) as cat, (select count(*)::int from public.exercise_catalog_aliases) as al, to_regclass('public.exercise_catalog_merge_log') as lg");
    const undoneSnap111 = await snapshot64();
    const differing111 = Object.keys(JSON.parse(before111.snap)).filter((k) => JSON.stringify(JSON.parse(before111.snap)[k]) !== JSON.stringify(JSON.parse(undoneSnap111)[k]));
    check("step 111: the undo runs, empties the catalog, drops its log and returns every table to exactly what it was" + (eu111 ? ": " + eu111 : "") + (differing111.length ? " (differs: " + differing111.join(", ") + ")" : ""), !eu111 && undone111.cat === 0 && undone111.al === 0 && undone111.lg === null && undoneSnap111 === before111.snap && afterSnap111 !== before111.snap);
    const re111 = await run("apply/apply-step111-catalog-merge-ron.sql");
    check("step 111: applies again after the undo and gives the same result" + (re111 ? ": " + re111 : ""), !re111 && (await snapshot64()) === afterSnap111);
  }
  if (s.n === "64") {
    const one = async (sql) => (await db.query(sql)).rows[0];
    const RON = "136394ed-f108-4283-bcb7-310a1ac6cbc8";
    const OTHER = "00000000-0000-4000-8000-0000000000f1";
    const G1 = "64000000-0000-4000-8000-000000000001";
    // (the fixture ran before the apply; its "before" picture is taken from the undo below, which must return to it)
    const after = await one(`select
      (select count(*)::int from public.exercise_library where created_by = '${RON}') as ron_lib,
      (select count(*)::int from public.exercise_library where created_by = '${RON}' and name in ('Deadlift', 'Conventional Deadlifts', 'Band Pull-Apart', 'Chin Ups', 'Dips', 'Dumbbell Lateral Raises', 'Farmer''s Carry', 'Lat Pull Down', 'Shoulder CARS', 'Sit Ups', 'Step Ups', 'Bulgarian Split Squats', 'Walking Lunges')) as losers_left,
      (select count(*)::int from public.exercise_library where created_by = '${RON}' and youtube_url is not null) as videos,
      (select count(*)::int from public.exercise_library where created_by = '${OTHER}') as other_lib,
      (select count(*)::int from public.group_workout_exercises where group_id = '${G1}' and exercise_name = 'Conventional Deadlift') as cd,
      (select count(*)::int from public.group_workout_exercises where group_id = '${G1}' and exercise_name = 'Dip') as dip,
      (select count(*)::int from public.group_workout_exercises where group_id = '${G1}' and exercise_name in ('Deadlift', 'Conventional Deadlifts', 'Dips')) as gwe_left,
      (select count(*)::int from public.group_workout_exercises where exercise_name = 'Deadlift' and group_id = '64000000-0000-4000-8000-000000000002') as other_gwe,
      (select count(*)::int from public.group_workout_exercise_sets) as sets,
      (select count(*)::int from public.session_exercises where exercise_name = 'Dip') as se_dip,
      (select count(*)::int from public.exercise_progressions where exercise_name = 'Conventional Deadlift' and config ? 'survivor') as pr_survivor,
      (select count(*)::int from public.exercise_progressions where exercise_name in ('Deadlift', 'Dips')) as pr_losers,
      (select count(*)::int from public.exercise_progressions where exercise_name = 'Dip' and config ? 'only') as pr_dip,
      (select string_agg(difficulty_rank::text, ',') from public.movement_pattern_exercises where movement_pattern_id = '64000000-0000-4000-8000-0000000000e1' and exercise_name = 'Conventional Deadlift') as mp_rank,
      (select count(*)::int from public.movement_pattern_exercises where movement_pattern_id = '64000000-0000-4000-8000-0000000000e1' and exercise_name in ('Deadlift', 'Step Ups')) as mp_left,
      (select count(*)::int from public.movement_pattern_exercises where movement_pattern_id = '64000000-0000-4000-8000-0000000000e1' and exercise_name = 'Step Up') as mp_step,
      (select count(*)::int from public.exercise_records where exercise_name = 'Dip') as rec,
      (select count(*)::int from public.athlete_training_maxes where exercise_name = 'Dip') as tm,
      (select count(*)::int from public.athlete_equipment_load_ratios where exercise_name_a = 'Dip' and exercise_name_b = 'Back Squat') as lr_a,
      (select count(*)::int from public.athlete_equipment_load_ratios where exercise_name_b = 'Step Up') as lr_b,
      (select count(*)::int from public.game_score_entries where exercise_name = 'Dip') as gs,
      (select string_agg(shared_exercise_names::text, '|') from public.posts where group_id = '${G1}') as post_names,
      (select string_agg(exercise_name, ',') from public.exercise_aliases where coach_id = '${RON}' and raw_name = 'dl') as ron_dl,
      (select string_agg(exercise_name, ',') from public.exercise_aliases where coach_id = '${OTHER}' and raw_name = 'dl') as other_dl,
      (select string_agg(exercise_name, ',') from public.exercise_aliases where coach_id = '${RON}' and raw_name = 'Conventional Deadlifts') as ron_alias_cds,
      (select string_agg(exercise_name, ',') from public.exercise_aliases where coach_id = '${RON}' and raw_name = 'Farmer''s Carry') as ron_alias_fc`);
    check("step 64: the 13 duplicates are gone from Ron's library and 12 remain (the 12 survivors plus his other entries)", after.losers_left === 0, JSON.stringify(after));
    check("step 64: every survivor keeps its video link", after.videos === 10);
    check("step 64: another coach's library is untouched (same two names, same rows)", after.other_lib === 2 && after.other_gwe === 1 && after.other_dl === "Deadlift");
    check("step 64: program exercises were renamed (3 Deadlift/Conventional Deadlifts to Conventional Deadlift, Dips to Dip) and every set is kept", after.cd === 3 && after.dip === 1 && after.gwe_left === 0 && after.sets === JSON.parse(before64.snap).sets, JSON.stringify(after));
    check("step 64: sessions, records, maxes, ratios, game scores, PR list and shared names follow", after.se_dip === 1 && after.rec === 1 && after.tm === 1 && after.lr_a === 1 && after.lr_b === 1 && after.gs === 1 && after.post_names === "{Dip,\"Back Squat\"}");
    check("step 64: where a program or pattern already had the survivor, the survivor row is kept and the duplicate is dropped", after.pr_survivor === 1 && after.pr_losers === 0 && after.pr_dip === 1 && after.mp_rank === "2" && after.mp_left === 0 && after.mp_step === 1, JSON.stringify(after));
    check("step 64: Ron's aliases follow, and each duplicate's name becomes an alias of its survivor", after.ron_dl === "Conventional Deadlift" && after.ron_alias_cds === "Conventional Deadlift" && after.ron_alias_fc === "Farmers Carry");
    const log = (await db.query("select tbl, count(*)::int as n from public.exercise_merge_log group by tbl")).rows;
    check("step 64: the log says how many rows changed per table" + " (" + JSON.stringify(log) + ")", log.length >= 10);
    // The undo returns everything to the state the fixture started from, and the step can be applied again.
    const afterSnap = await snapshot64();
    const eu64 = await run("apply/undo-step64-merge-duplicate-exercises.sql");
    const undoneSnap = await snapshot64();
    const undoneLeft = (await db.query("select to_regclass('public.exercise_merge_log') as a, to_regclass('public.exercise_merge_deleted') as b")).rows[0];
    check("step 64: the undo runs, drops its log tables, and returns every table to exactly what it was before the merge" + (eu64 ? ": " + eu64 : ""), !eu64 && undoneLeft.a === null && undoneLeft.b === null && undoneSnap === before64.snap && undoneSnap !== afterSnap);
    const undone = await one(`select
      (select count(*)::int from public.exercise_library where created_by = '${RON}' and name in ('Deadlift', 'Conventional Deadlifts', 'Dips')) as lib,
      (select count(*)::int from public.group_workout_exercises where group_id = '${G1}' and exercise_name in ('Deadlift', 'Conventional Deadlifts', 'Dips')) as gwe,
      (select count(*)::int from public.exercise_progressions where exercise_name in ('Deadlift', 'Dips')) as pr,
      (select count(*)::int from public.movement_pattern_exercises where movement_pattern_id = '64000000-0000-4000-8000-0000000000e1' and exercise_name in ('Deadlift', 'Step Ups')) as mp,
      (select string_agg(exercise_name, ',') from public.exercise_aliases where coach_id = '${RON}' and raw_name = 'dl') as ron_dl,
      (select count(*)::int from public.exercise_aliases where coach_id = '${RON}' and raw_name = 'Conventional Deadlifts') as added_alias,
      (select string_agg(shared_exercise_names::text, '|') from public.posts where group_id = '${G1}') as post_names`);
    check("step 64: after the undo the duplicates, their program rows, rules and pattern rows are back and the added aliases are gone", undone.lib === 3 && undone.gwe === 4 && undone.pr === 2 && undone.mp === 2 && undone.ron_dl === "Deadlift" && undone.added_alias === 0 && undone.post_names === "{Dips,\"Back Squat\"}", JSON.stringify(undone));
    const reapply64 = await run("apply/apply-step64-merge-duplicate-exercises.sql");
    check("step 64: applies again after the undo and gives the same result" + (reapply64 ? ": " + reapply64 : ""), !reapply64 && (await snapshot64()) === afterSnap);
  }
  if (Number(s.n) >= 12) {
    // The newer steps: a precheck run again flags it as already applied, the undo file runs, and the step can then be applied again.
    const again = await pre(`${base}-precheck.sql`);
    check(`step ${s.n} precheck run again after applying has a false row ("already applied")`, again.some((r) => !r.ok));
    const eu = await run(`apply/undo-step${s.n}-${s.slug}.sql`);
    check(`undo-step${s.n}-${s.slug}.sql runs` + (eu ? ": " + eu : ""), !eu);
    // A deletion cannot be undone by a file: after step 31 the undo only lists what was saved, so it is not applied again.
    if (s.n !== "31") {
      const ea = await run(`${base}.sql`);
      check(`step ${s.n} applies again after its undo` + (ea ? ": " + ea : ""), !ea);
    }
  }
  if (s.n === "06") {
    // The migration-history file records only what is in the database so far (not 0252, 0237, 0238, 0242), and can be run twice.
    await db.exec("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[])");
    const eh = await run("apply/record-history-applied.sql");
    const eh2 = await run("apply/record-history-applied.sql");
    const recorded = (await db.query("select name from supabase_migrations.schema_migrations")).rows.map((r) => r.name);
    check("history file after step 06: records the applied ones (23), not 0252/0237/0238/0242, and a second run adds nothing" + (eh || eh2 ? `: ${eh || eh2}` : ""),
      !eh && !eh2 && recorded.length === 23 && !recorded.some((n) => /^(drop_plaintext_kiosk_pin|join_group_with_invite|close_loose_self_join_policy|invite_revocation)$/.test(n)), recorded.length);
    const ok = (await db.query(`select public.verify_kiosk_pin('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', '4821') as r`).catch(() => null));
    // verify_kiosk_pin needs a signed-in coach; the data check is that the hash exists.
    const hashed = (await db.query(`select count(*)::int as n from public.kiosk_pins where athlete_id = '00000000-0000-4000-8000-0000000000a2'`)).rows[0].n;
    check("step 06: the existing plain PIN was copied across hashed", hashed === 1);
  }
}
// ---- release bundles: ONE paste per release ----
// Steps 32 to 34 are applied at this point. Take them back with their own undo files (newest first), so the bundle runs on the same state live has before Release D.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-d");
  const file = `apply/${bundle.file}`;
  const stepFiles = bundle.steps.map((n) => steps.find((x) => x.n === n));
  const undoAll = async () => {
    for (const st of [...stepFiles].reverse()) {
      const eu = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
      if (eu) return eu;
    }
    return null;
  };
  const state = async () => (await db.query(`select
      exists (select 1 from pg_constraint where conname = 'coach_availability_windows_session_minutes_range' and pg_get_constraintdef(oid) like '%slot_duration_minutes%') as old_rule,
      exists (select 1 from pg_trigger where tgname = 'bookings_guard_overlap') as has_guard,
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_type_id') as has_tag`)).rows[0];

  check(`bundle ${bundle.id}: the steps can be taken back with their own undo files first`, !(await undoAll()));
  const before = await state();
  check("bundle: before it runs, none of its three changes is in place", before.old_rule && !before.has_guard && !before.has_tag, JSON.stringify(before));

  // All or nothing: make the LAST step's state wrong (its column already exists), and the whole bundle must refuse, naming step 34, and keep NOTHING of steps 32 and 33.
  await db.exec("alter table public.coach_availability_windows add column session_type_id uuid");
  const refusedLate = await run(file);
  const afterLate = await state();
  check("bundle: a wrong state in the LAST step refuses with the step named (" + refusedLate + ")", !!refusedLate && /step 34 \(0289\) cannot run/.test(refusedLate) && /already applied/.test(refusedLate));
  check("bundle: that refusal kept NOTHING of the earlier steps (all or nothing)", afterLate.old_rule && !afterLate.has_guard, JSON.stringify(afterLate));
  await db.exec("alter table public.coach_availability_windows drop column session_type_id");

  // The real run: applies, and the result row says every step is in place.
  const bundleSql = read(file);
  let result;
  let errBundle = null;
  try {
    result = await db.exec(bundleSql);
  } catch (err) {
    errBundle = err.message.split("\n")[0];
    await db.exec("rollback").catch(() => {});
  }
  const rowsOut = Array.isArray(result) ? result[result.length - 1].rows : result?.rows ?? [];
  check("bundle applies on the live-shaped state" + (errBundle ? ": " + errBundle : ""), !errBundle);
  check("bundle: ends with a read-only result, one row per step, every in_place = true " + JSON.stringify(rowsOut.map((r) => [r.step, r.in_place])), rowsOut.length === 3 && rowsOut.every((r) => r.in_place === true));
  const after = await state();
  check("bundle: all three changes are in place", !after.old_rule && after.has_guard && after.has_tag, JSON.stringify(after));

  // Running it again (or after any step was applied by hand) is refused at the first applied step, naming it, and changes nothing.
  const again = await run(file);
  check("bundle: a second run is refused, naming step 32 (" + again + ")", !!again && /step 32 \(0287\) cannot run/.test(again) && /already applied/.test(again));
  const afterAgain = await state();
  check("bundle: the refused second run changed nothing", !afterAgain.old_rule && afterAgain.has_guard && afterAgain.has_tag);

  // The per-step undo files still work after the bundle, and each step can be applied again by its own file (the fallback).
  for (const st of [...stepFiles].reverse()) {
    const eu = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
    check(`bundle: undo-step${st.n}-${st.slug}.sql runs after the bundle` + (eu ? ": " + eu : ""), !eu);
  }
  const undone = await state();
  check("bundle: after the undo files everything is back to the old state", undone.old_rule && !undone.has_guard && !undone.has_tag, JSON.stringify(undone));
  for (const st of stepFiles) {
    const rows = await pre(`apply/apply-step${st.n}-${st.slug}-precheck.sql`);
    const ea = await run(`apply/apply-step${st.n}-${st.slug}.sql`);
    check(`bundle fallback: step ${st.n} precheck all true, and its own file applies after the undo` + (ea ? ": " + ea : ""), rows.every((r) => r.ok) && !ea);
  }
}
// ---- Release F bundle (steps 35 to 37): the same all-or-nothing checks ----
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-f");
  const file = `apply/${bundle.file}`;
  const stepFiles = bundle.steps.map((n) => steps.find((x) => x.n === n));
  const state = async () => (await db.query(`select
      exists (select 1 from pg_trigger where tgname = 'group_memberships_guard_identity') as has_guard,
      coalesce((select position('that coach does not coach this group' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace), false) as has_booking,
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_log' and column_name = 'error_class') as has_col,
      has_function_privilege('authenticated', 'public.spend_ai_action(uuid, text, integer, integer)', 'execute') as ai_open`)).rows[0];
  for (const st of [...stepFiles].reverse()) {
    const eu = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
    check(`bundle release-f: undo-step${st.n}-${st.slug}.sql runs` + (eu ? ": " + eu : ""), !eu);
  }
  const before = await state();
  check("release-f: before it runs none of its changes is in place and the AI spend function is open to signed-in users", !before.has_guard && !before.has_booking && !before.has_col && before.ai_open, JSON.stringify(before));

  await db.exec("alter table public.ai_usage_log add column error_class text");
  const refusedLate = await run(file);
  const afterLate = await state();
  check("release-f: a wrong state in the LAST step refuses with the step named (" + refusedLate + ")", !!refusedLate && /step 37 \(0292\) cannot run/.test(refusedLate) && /already applied/.test(refusedLate));
  check("release-f: that refusal kept NOTHING of the earlier steps (all or nothing)", !afterLate.has_guard && !afterLate.has_booking && afterLate.ai_open, JSON.stringify(afterLate));
  await db.exec("alter table public.ai_usage_log drop column error_class");

  let result;
  let errBundle = null;
  try {
    result = await db.exec(read(file));
  } catch (err) {
    errBundle = err.message.split("\n")[0];
    await db.exec("rollback").catch(() => {});
  }
  const rowsOut = Array.isArray(result) ? result[result.length - 1].rows : result?.rows ?? [];
  check("release-f bundle applies on the live-shaped state" + (errBundle ? ": " + errBundle : ""), !errBundle);
  check("release-f: ends with a read-only result, one row per step, every in_place = true " + JSON.stringify(rowsOut.map((r) => [r.step, r.in_place])), rowsOut.length === 3 && rowsOut.every((r) => r.in_place === true));
  const after = await state();
  check("release-f: all three changes are in place and the AI spend function is closed to signed-in users", after.has_guard && after.has_booking && after.has_col && !after.ai_open, JSON.stringify(after));
  const again = await run(file);
  check("release-f: a second run is refused, naming step 35 (" + again + ")", !!again && /step 35 \(0290\) cannot run/.test(again) && /already applied/.test(again));
}
// Release H (step 38): a signed-in coach can no longer name 'auto_validator_failure' for a refund; the logic moves to a server-only function. One all-or-nothing paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-h");
  const file = `apply/${bundle.file}`;
  const st = steps.find((x) => x.n === "38");
  const state = async () => (await db.query(`select
      to_regprocedure('public.refund_coach_credit_for(uuid, text, text, text, text, uuid)') is not null as has_for,
      position('refund_coach_credit_for' in pg_get_functiondef('public.refund_coach_credit(text, text, text, text)'::regprocedure)) > 0 as only_flag,
      has_function_privilege('authenticated', 'public.refund_coach_credit(text, text, text, text)', 'execute') as flag_auth,
      has_function_privilege('anon', 'public.refund_coach_credit(text, text, text, text)', 'execute') as flag_anon,
      coalesce(has_function_privilege('authenticated', to_regprocedure('public.refund_coach_credit_for(uuid, text, text, text, text, uuid)'), 'execute'), false) as for_auth`)).rows[0];
  const eu = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
  check("release-h: undo-step38-0293.sql runs" + (eu ? ": " + eu : ""), !eu);
  const before = await state();
  check("release-h: before it runs the server-only refund function is absent and the signed-in refund does not insist on the coach flag", !before.has_for && !before.only_flag, JSON.stringify(before));
  const err = await run(file);
  check("release-h bundle applies on the live-shaped state" + (err ? ": " + err : ""), !err);
  const after = await state();
  check("release-h: the server-only function exists and is closed to signed-in users", after.has_for && !after.for_auth, JSON.stringify(after));
  check("release-h: the signed-in refund keeps its grants (signed-in yes, public no) and now accepts only the coach flag", after.only_flag && after.flag_auth && !after.flag_anon, JSON.stringify(after));
  const again = await run(file);
  check("release-h: a second run is refused, naming step 38 (" + again + ")", !!again && /step 38 \(0293\) cannot run/.test(again) && /already applied/.test(again));
}
// Release I (step 39): food preferences. Applies on the live-shaped state, the undo puts the notification types back to the live list without the three new ones, and a
// second run is refused. A live type with a digit and a capital (what another release might add) must come through the apply and the undo unchanged.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-i");
  const file = `apply/${bundle.file}`;
  const st = steps.find((x) => x.n === "39");
  const state = async () => (await db.query(`select
      to_regclass('public.client_nutrition_preferences') is not null as prefs,
      to_regclass('public.client_nutrition_feedback') is not null as fb,
      coalesce((select pg_get_constraintdef(oid) like '%nutrition_preferences_changed%' from pg_constraint where conname = 'notifications_type_check'), false) as new_type,
      coalesce((select pg_get_constraintdef(oid) like '%goal_answered%' and pg_get_constraintdef(oid) like '%comment%' from pg_constraint where conname = 'notifications_type_check'), false) as old_types`)).rows[0];
  const typeList = async () => {
    const def = (await db.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notifications_type_check'`)).rows[0].d;
    return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
  };
  const widenedList = [...(await typeList()), "Legacy_Type2"];
  await db.query("alter table public.notifications drop constraint notifications_type_check");
  await db.query(`alter table public.notifications add constraint notifications_type_check check (type = any (array[${widenedList.map((t) => "'" + t + "'::text").join(", ")}]))`);
  const eu = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
  check("release-i: undo-step39-0294.sql runs before the step (nothing to undo)" + (eu ? ": " + eu : ""), !eu);
  const listBefore = await typeList();
  const before = await state();
  check("release-i: before it runs neither table exists and the new types are not allowed", !before.prefs && !before.fb && !before.new_type && before.old_types, JSON.stringify(before));
  const err = await run(file);
  check("release-i bundle applies on the live-shaped state" + (err ? ": " + err : ""), !err);
  const after = await state();
  check("release-i: both tables exist, the new types are allowed and every old type still is", after.prefs && after.fb && after.new_type && after.old_types, JSON.stringify(after));
  const listAfter = await typeList();
  const newThree = ["nutrition_preferences_changed", "nutrition_prompt_answered", "nutrition_allergies_updated"];
  check("release-i: the full live type list before is inside the list after (including Legacy_Type2), plus exactly the three new types", listBefore.every((t) => listAfter.includes(t)) && listAfter.includes("Legacy_Type2") && listAfter.length === listBefore.length + 3 && newThree.every((t) => listAfter.includes(t)), JSON.stringify({ before: listBefore.length, after: listAfter.length }));
  const again = await run(file);
  check("release-i: a second run is refused, naming step 39 (" + again + ")", !!again && /step 39 \(0294\) cannot run/.test(again) && /already applied/.test(again));
  const eu2 = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
  check("release-i: the undo runs after the step" + (eu2 ? ": " + eu2 : ""), !eu2);
  const undone = await state();
  check("release-i: after the undo both tables are gone, the new types are gone and every old type is kept", !undone.prefs && !undone.fb && !undone.new_type && undone.old_types, JSON.stringify(undone));
  const listUndone = await typeList();
  check("release-i: after the undo the type list is exactly what it was before the step", JSON.stringify(listUndone) === JSON.stringify(listBefore), JSON.stringify({ before: listBefore.length, undone: listUndone.length }));
  const err2 = await run(file);
  check("release-i: the bundle applies again after an undo" + (err2 ? ": " + err2 : ""), !err2);
}
// Release J (step 40): about you, baseline, phase of record. Applies on the live-shaped state, a second run is refused, the undo puts everything back (the notification
// types exactly as they were, the required columns required again, guard_client_goal_update as 0284 had it), and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-j");
  const file = `apply/${bundle.file}`;
  const st = steps.find((x) => x.n === "40");
  const state = async () => (await db.query(`select
      to_regclass('public.client_phase_plans') is not null as plans,
      exists (select 1 from information_schema.columns where table_name = 'client_goals' and column_name = 'nutrition_phase') as goal_phase,
      exists (select 1 from information_schema.columns where table_name = 'athlete_profile_details' and column_name = 'activity_level') as activity,
      exists (select 1 from information_schema.columns where table_name = 'nutrition_checkin_suggestions' and column_name = 'kind') as kind,
      (select is_nullable = 'NO' from information_schema.columns where table_name = 'nutrition_checkins' and column_name = 'prev_weight_lbs') as weight_required,
      to_regprocedure('public.coach_set_body_profile(uuid, uuid, numeric, text, numeric, text, text, text, boolean)') is not null as fn,
      (select md5(replace(replace(pg_get_functiondef(p.oid), chr(13), ''), 'new.nutrition_phase := null;', '')) from pg_proc p where p.oid = to_regprocedure('public.guard_client_goal_update()')) as guard_md5`)).rows[0];
  const typeList = async () => {
    const def = (await db.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notifications_type_check'`)).rows[0].d;
    return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
  };
  const widenedList = [...(await typeList()).filter((t) => t !== "Legacy_Type2"), "Legacy_Type2"];
  await db.query("alter table public.notifications drop constraint notifications_type_check");
  await db.query(`alter table public.notifications add constraint notifications_type_check check (type = any (array[${widenedList.map((t) => "'" + t + "'::text").join(", ")}]))`);
  const eu = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
  check("release-j: undo-step40-0295.sql runs before the step (nothing to undo)" + (eu ? ": " + eu : ""), !eu);
  const listBefore = await typeList();
  const before = await state();
  check("release-j: before it runs none of the new objects exist and a check-in still needs a previous weight", !before.plans && !before.goal_phase && !before.activity && !before.kind && before.weight_required && !before.fn, JSON.stringify(before));
  const err = await run(file);
  check("release-j bundle applies on the live-shaped state" + (err ? ": " + err : ""), !err);
  const after = await state();
  check("release-j: the table, columns and function exist and a baseline no longer needs a previous weight", after.plans && after.goal_phase && after.activity && after.kind && !after.weight_required && after.fn, JSON.stringify(after));
  const listAfter = await typeList();
  check("release-j: the full type list before is inside the list after, plus exactly the one new type", listBefore.every((t) => listAfter.includes(t)) && listAfter.length === listBefore.length + 1 && listAfter.includes("nutrition_baseline_ready") && listAfter.includes("Legacy_Type2"), JSON.stringify({ before: listBefore.length, after: listAfter.length }));
  const again = await run(file);
  check("release-j: a second run is refused, naming step 40 (" + again + ")", !!again && /step 40 \(0295\) cannot run/.test(again) && /already applied/.test(again));
  const eu2 = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
  check("release-j: the undo runs after the step" + (eu2 ? ": " + eu2 : ""), !eu2);
  const undone = await state();
  check("release-j: after the undo the new objects are gone, a check-in needs a previous weight again, and the goal guard has its 0284 text", !undone.plans && !undone.goal_phase && !undone.activity && !undone.kind && undone.weight_required && !undone.fn && undone.guard_md5 === before.guard_md5, JSON.stringify({ undone, before }));
  const listUndone = await typeList();
  check("release-j: after the undo the type list is exactly what it was before the step", JSON.stringify(listUndone) === JSON.stringify(listBefore), JSON.stringify({ before: listBefore.length, undone: listUndone.length }));
  const err2 = await run(file);
  check("release-j: the bundle applies again after an undo" + (err2 ? ": " + err2 : ""), !err2);
}
// Release K (step 41): recipe library columns. Applies on the live-shaped state, a second run is refused, the undo removes exactly the new columns, checks, index and guard,
// existing recipes and their lines survive both ways, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-k");
  const file = `apply/${bundle.file}`;
  const st = steps.find((x) => x.n === "41");
  const state = async () => (await db.query(`select
      exists (select 1 from information_schema.columns where table_name = 'recipes' and column_name = 'content_hash') as hash,
      exists (select 1 from information_schema.columns where table_name = 'recipes' and column_name = 'source') as source,
      exists (select 1 from information_schema.columns where table_name = 'recipe_ingredients' and column_name = 'grams_ref') as grams,
      exists (select 1 from pg_trigger where tgname = 'recipe_ingredients_guard_ai') as guard,
      to_regclass('public.recipes_owner_content_hash_uniq') is not null as idx,
      (select count(*)::int from public.recipes) as recipes,
      (select count(*)::int from public.recipe_ingredients) as lines`)).rows[0];
  const eu = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
  check("release-k: undo-step41-0296.sql runs before the step (nothing to undo)" + (eu ? ": " + eu : ""), !eu);
  const before = await state();
  check("release-k: before it runs none of the new objects exist", !before.hash && !before.source && !before.grams && !before.guard && !before.idx, JSON.stringify(before));
  const err = await run(file);
  check("release-k bundle applies on the live-shaped state" + (err ? ": " + err : ""), !err);
  const after = await state();
  check("release-k: the columns, index and guard exist and no recipe or line was lost", after.hash && after.source && after.grams && after.guard && after.idx && after.recipes === before.recipes && after.lines === before.lines, JSON.stringify(after));
  const again = await run(file);
  check("release-k: a second run is refused, naming step 41 (" + again + ")", !!again && /step 41 \(0296\) cannot run/.test(again) && /already applied/.test(again));
  const eu2 = await run(`apply/undo-step${st.n}-${st.slug}.sql`);
  check("release-k: the undo runs after the step" + (eu2 ? ": " + eu2 : ""), !eu2);
  const undone = await state();
  check("release-k: after the undo the new objects are gone and every recipe and line is still there", !undone.hash && !undone.source && !undone.grams && !undone.guard && !undone.idx && undone.recipes === before.recipes && undone.lines === before.lines, JSON.stringify(undone));
  const err2 = await run(file);
  check("release-k: the bundle applies again after an undo" + (err2 ? ": " + err2 : ""), !err2);
}
// Release L (steps 42 and 43): schedule requests and Read during rest, ONE paste. Applies on the live-shaped state, a second run is refused naming the first step, the undo
// files (newest first) remove exactly the new tables, columns, functions and the notification types, existing schedules survive both ways, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-l");
  const file = `apply/${bundle.file}`;
  const st = steps.find((x) => x.n === "42");
  const st43 = steps.find((x) => x.n === "43");
  const undoBoth = async () => (await run(`apply/undo-step${st43.n}-${st43.slug}.sql`)) || (await run(`apply/undo-step${st.n}-${st.slug}.sql`));
  const state = async () => (await db.query(`select
      to_regclass('public.schedule_requests') is not null as requests,
      to_regclass('public.schedule_request_notes') is not null as notes,
      exists (select 1 from information_schema.columns where table_name = 'recurring_booking_series' and column_name = 'frozen_from') as frozen,
      exists (select 1 from information_schema.columns where table_name = 'recurring_booking_series' and column_name = 'resume_attempts') as attempts,
      to_regclass('public.read_settings') is not null as read_settings,
      to_regclass('public.read_passage_overrides') is not null as read_overrides,
      exists (select 1 from information_schema.columns where table_name = 'coach_preferences' and column_name = 'faith_track_default') as coach_switch,
      (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('request_schedule_change','withdraw_schedule_request','dismiss_schedule_request','claim_schedule_request','claim_due_schedule_requests','finish_schedule_request','end_schedule_freeze','claim_due_freeze_resumes','fail_freeze_resume','note_schedule_resumed','extend_expiry_for_freeze','schedule_request_recipients','schedule_local_today','schedule_expiry_window_days','shorten_expiry_after_freeze','settle_schedule_freeze','recurring_series_freeze_guard','read_track_for_me')) as fns,
      (select count(*)::int from public.recurring_booking_series) as series`)).rows[0];
  const typeList = async () => {
    const def = (await db.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notifications_type_check'`)).rows[0].d;
    return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
  };
  const eu = await undoBoth();
  check("release-l: the undo files run before the steps (nothing to undo)" + (eu ? ": " + eu : ""), !eu);
  const before = await state();
  const listBefore = await typeList();
  check("release-l: before it runs none of the new objects exist", !before.requests && !before.notes && !before.frozen && !before.attempts && !before.read_settings && !before.read_overrides && !before.coach_switch && before.fns === 0, JSON.stringify(before));
  const err = await run(file);
  check("release-l bundle applies on the live-shaped state" + (err ? ": " + err : ""), !err);
  const after = await state();
  const listAfter = await typeList();
  check("release-l: every new table, column and function exists and no schedule was lost", after.requests && after.notes && after.frozen && after.attempts && after.read_settings && after.read_overrides && after.coach_switch && after.fns === 18 && after.series === before.series, JSON.stringify(after));
  check("release-l: the type list keeps every old type and adds exactly the three new ones", listBefore.every((t) => listAfter.includes(t)) && listAfter.length === listBefore.length + 3 && ["schedule_request", "schedule_applied", "schedule_resumed"].every((t) => listAfter.includes(t)), JSON.stringify({ before: listBefore.length, after: listAfter.length }));
  const again = await run(file);
  check("release-l: a second run is refused, naming step 42 (" + again + ")", !!again && /step 42 \(0297\) cannot run/.test(again) && /already applied/.test(again));
  const eu2 = await undoBoth();
  check("release-l: the undo files run after the steps" + (eu2 ? ": " + eu2 : ""), !eu2);
  const undone = await state();
  const listUndone = await typeList();
  check("release-l: after the undo the new objects are gone and every schedule is still there", !undone.requests && !undone.notes && !undone.frozen && !undone.attempts && !undone.read_settings && !undone.read_overrides && !undone.coach_switch && undone.fns === 0 && undone.series === before.series, JSON.stringify(undone));
  check("release-l: after the undo the type list is exactly what it was before the steps", JSON.stringify(listUndone) === JSON.stringify(listBefore), JSON.stringify({ before: listBefore.length, undone: listUndone.length }));
  const err2 = await run(file);
  check("release-l: the bundle applies again after an undo" + (err2 ? ": " + err2 : ""), !err2);
}
// Release N (steps 45 and 46): nutrition tracking, ONE paste. Applies on the live-shaped state, a second run is refused naming step 45, the undo files (newest first) remove exactly
// the new tables, columns and function, existing food logs and memberships survive both ways, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-n");
  const file = `apply/${bundle.file}`;
  const st45 = steps.find((x) => x.n === "45");
  const st46 = steps.find((x) => x.n === "46");
  const st47 = steps.find((x) => x.n === "47");
  const st48 = steps.find((x) => x.n === "48");
  const st49 = steps.find((x) => x.n === "49");
  const st50 = steps.find((x) => x.n === "50");
  const bundle2 = bundles.find((b) => b.id === "release-n2");
  const undoBoth = async () =>
    (await run(`apply/undo-step${st50.n}-${st50.slug}.sql`)) || (await run(`apply/undo-step${st49.n}-${st49.slug}.sql`)) || (await run(`apply/undo-step${st48.n}-${st48.slug}.sql`)) || (await run(`apply/undo-step${st47.n}-${st47.slug}.sql`)) || (await run(`apply/undo-step${st46.n}-${st46.slug}.sql`)) || (await run(`apply/undo-step${st45.n}-${st45.slug}.sql`));
  const state = async () => (await db.query(`select
      to_regclass('public.usda_food_portions') is not null as portions,
      to_regclass('public.usda_load_batches') is not null as batches,
      exists (select 1 from information_schema.columns where table_name = 'food_log_entries' and column_name = 'fdc_id') as fdc,
      exists (select 1 from information_schema.columns where table_name = 'food_log_entries' and column_name = 'nutrients') as snapshot,
      exists (select 1 from information_schema.columns where table_name = 'group_memberships' and column_name = 'food_tracking_enabled') as switch,
      to_regclass('public.ai_budget_notices') is not null as notices,
      to_regclass('public.custom_foods') is not null as custom,
      to_regclass('public.saved_meals') is not null as meals,
      to_regclass('public.client_billing_rates') is not null as rates,
      exists (select 1 from information_schema.columns where table_name = 'group_memberships' and column_name = 'monthly_rate') as ratecol,
      exists (select 1 from pg_proc where proname = 'ai_org_month_usage' and pronamespace = 'public'::regnamespace) as fn,
      (select count(*)::int from public.food_log_entries) as logs,
      (select count(*)::int from public.group_memberships) as memberships`)).rows[0];
  const eu = await undoBoth();
  check("release-n: the undo files run before the steps (nothing to undo)" + (eu ? ": " + eu : ""), !eu);
  const before = await state();
  await db.exec("update public.group_memberships set monthly_rate = 120 where id = (select id from public.group_memberships where role = 'athlete' order by id limit 1)");
  check("release-n: before it runs none of the new objects exist (the old rate column is still there)", before.ratecol && !before.rates && !before.portions && !before.batches && !before.fdc && !before.snapshot && !before.switch && !before.notices && !before.fn && !before.custom && !before.meals, JSON.stringify(before));
  const err = await run(file);
  check("release-n bundle applies on the live-shaped state" + (err ? ": " + err : ""), !err);
  const after = await state();
  check("release-n: every new table, column and function exists and no food log or membership was lost", after.portions && after.batches && after.fdc && after.snapshot && after.switch && after.notices && after.fn && after.custom && after.meals && after.rates && after.ratecol && after.logs === before.logs && after.memberships === before.memberships, JSON.stringify(after));
  const movedRate = (await db.query("select count(*)::int as n, coalesce(sum(monthly_rate), 0)::numeric as total from public.client_billing_rates")).rows[0];
  check("release-n: the rate set on a client moved to the coach-only table and nothing else came with it", movedRate.n === 1 && Number(movedRate.total) === 120, JSON.stringify(movedRate));
  const leftInOld = (await db.query("select count(*)::int as n from public.group_memberships where monthly_rate is not null")).rows[0].n;
  check("release-n: the old rate column is kept but emptied (the code live today still selects it and carries on; the rates are no longer readable there)", after.ratecol && leftInOld === 0, leftInOld);
  const again = await run(file);
  check("release-n: a second run is refused, naming step 45 (" + again + ")", !!again && again.includes("step 45 (0300) cannot run") && again.includes("already applied"));
  // Part two, after the deploy: anything the old code wrote into the old column in the meantime is copied across, then the column goes.
  await db.exec("update public.group_memberships set monthly_rate = 130 where id = (select id from public.group_memberships where role = 'athlete' order by id limit 1)");
  await db.exec("update public.group_memberships set monthly_rate = 77 where id = (select id from public.group_memberships where role = 'athlete' order by id offset 1 limit 1)");
  const errN2 = await run(`apply/${bundle2.file}`);
  check("release-n part 2 (after the deploy) applies" + (errN2 ? ": " + errN2 : ""), !errN2);
  const afterN2 = await state();
  const rateRowsN2 = (await db.query("select count(*)::int as n, coalesce(sum(monthly_rate), 0)::numeric as total from public.client_billing_rates")).rows[0];
  check("release-n part 2: the old column is gone and a rate written there in the gap was copied across first (a newer edit wins over the row step 48 made)", !afterN2.ratecol && afterN2.rates && rateRowsN2.n === 2 && Number(rateRowsN2.total) === 207, JSON.stringify({ afterN2, rateRowsN2 }));
  const drawsTable = (await db.query("select to_regclass('public.ai_topup_draws') is not null as present")).rows[0].present;
  const drawsLocked = (await db.query("select has_table_privilege('authenticated', 'public.ai_topup_draws', 'select') as auth_read, has_table_privilege('anon', 'public.ai_topup_draws', 'select') as anon_read")).rows[0];
  check("release-n part 2: the top-up balance record (step 50) is created and closed to signed-in and signed-out users", drawsTable && !drawsLocked.auth_read && !drawsLocked.anon_read, JSON.stringify({ drawsTable, drawsLocked }));
  const againN2 = await run(`apply/${bundle2.file}`);
  check("release-n part 2: a second run is refused (" + againN2 + ")", !!againN2 && againN2.includes("already applied"));
  const eN2 = await run(`apply/undo-step${st49.n}-${st49.slug}.sql`);
  const backN2 = (await db.query("select count(*)::int as n from public.group_memberships where monthly_rate is not null")).rows[0].n;
  check("release-n part 2: its undo puts the column back with the rates" + (eN2 ? ": " + eN2 : ""), !eN2 && backN2 === 2, backN2);
  await db.exec("update public.group_memberships set monthly_rate = null");
  const eu2 = await undoBoth();
  check("release-n: the undo files run after the steps" + (eu2 ? ": " + eu2 : ""), !eu2);
  const undone = await state();
  check("release-n: after the undo the new objects are gone and every food log and membership is still there", !undone.portions && !undone.batches && !undone.fdc && !undone.snapshot && !undone.switch && !undone.notices && !undone.fn && !undone.custom && !undone.meals && !undone.rates && undone.ratecol && undone.logs === before.logs && undone.memberships === before.memberships, JSON.stringify(undone));
  const restoredRate = (await db.query("select count(*)::int as n, coalesce(sum(monthly_rate), 0)::numeric as total from public.group_memberships where monthly_rate is not null")).rows[0];
  check("release-n: the undo puts the clients' rates back on the roster rows", restoredRate.n === 2 && Number(restoredRate.total) === 207, JSON.stringify(restoredRate));
  const err2 = await run(file);
  check("release-n: the bundle applies again after an undo" + (err2 ? ": " + err2 : ""), !err2);
}
// Release M (step 44): the acceptance record is append-only, ONE paste. Applies on the live-shaped state, a second run is refused, the undo removes exactly the triggers and
// the function and gives the privileges back, existing acceptances survive both ways, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-m");
  const file = `apply/${bundle.file}`;
  const st44 = steps.find((x) => x.n === "44");
  const undo = async () => run(`apply/undo-step${st44.n}-${st44.slug}.sql`);
  const state = async () => (await db.query(`select
      exists (select 1 from pg_trigger where tgname = 'legal_acceptances_append_only' and tgrelid = 'public.legal_acceptances'::regclass) as row_trigger,
      exists (select 1 from pg_trigger where tgname = 'legal_acceptances_no_truncate' and tgrelid = 'public.legal_acceptances'::regclass) as trunc_trigger,
      exists (select 1 from pg_proc where proname = 'legal_acceptances_refuse_changes' and pronamespace = 'public'::regnamespace) as fn,
      has_table_privilege('authenticated', 'public.legal_acceptances', 'UPDATE') as can_update,
      (select count(*)::int from public.legal_acceptances) as rows`)).rows[0];
  const eu = await undo();
  check("release-m: the undo file runs before the step (nothing to undo)" + (eu ? ": " + eu : ""), !eu);
  const before = await state();
  check("release-m: before it runs there is no trigger and the app's role can still update", !before.row_trigger && !before.trunc_trigger && !before.fn && before.can_update === true, JSON.stringify(before));
  const err = await run(file);
  check("release-m bundle applies on the live-shaped state" + (err ? ": " + err : ""), !err);
  const after = await state();
  check("release-m: both triggers and the function exist, the app's role lost update, and no acceptance was lost", after.row_trigger && after.trunc_trigger && after.fn && after.can_update === false && after.rows === before.rows, JSON.stringify(after));
  const again = await run(file);
  check("release-m: a second run is refused, naming step 44 (" + again + ")", !!again && /step 44 \(0299\) cannot run/.test(again) && /already applied/.test(again));
  const eu2 = await undo();
  check("release-m: the undo file runs after the step" + (eu2 ? ": " + eu2 : ""), !eu2);
  const undone = await state();
  check("release-m: after the undo the triggers and function are gone, the privileges are back and every acceptance is still there", !undone.row_trigger && !undone.trunc_trigger && !undone.fn && undone.can_update === true && undone.rows === before.rows, JSON.stringify(undone));
  const err2 = await run(file);
  check("release-m: the bundle applies again after an undo" + (err2 ? ": " + err2 : ""), !err2);
}
// Steps 30 and 31: the copy matches the original, both groups are gone, and everything in them was saved first.
{
  const gone = (await db.query("select count(*)::int as n from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')")).rows[0].n;
  const kept = (await db.query("select count(*)::int as n from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program'")).rows[0].n;
  const backup = (await db.query("select jsonb_array_length(payload -> 'programs') as programs, jsonb_array_length(payload -> 'workouts') as workouts, jsonb_array_length(payload -> 'sets') as sets from public.cleanup_backups")).rows;
  check("step 31: both groups are deleted, the copy survives in The Home Team, and the backup holds both programs, their workouts and sets", gone === 0 && kept === 1 && backup.length === 1 && backup[0].programs === 2 && backup[0].workouts === 3 && backup[0].sets === 4, JSON.stringify({ gone, kept, backup }));
  // The restore file puts both groups back from the backup (and refuses to run on top of groups that exist); the groups are then deleted again so nothing later depends on them.
  const savedKeys = (await db.query("select count(*)::int as n from public.cleanup_backups, jsonb_object_keys(payload)")).rows[0].n;
  check("step 31: the backup also holds wellness check-ins, view state and Spotter dismissals", savedKeys === 11, savedKeys);
  const er = await run("apply/restore-step31-from-backup.sql");
  const back = (await db.query("select (select count(*)::int from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) as g, (select count(*)::int from public.programs where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) as p, (select count(*)::int from public.workouts where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) as w, (select count(*)::int from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id where x.group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) as s")).rows[0];
  check("restore-step31-from-backup.sql puts both groups, their programs, workouts and sets back" + (er ? ": " + er : ""), !er && back.g === 2 && back.p === 2 && back.w === 3 && back.s === 4, JSON.stringify(back));
  const er2 = await run("apply/restore-step31-from-backup.sql");
  check("restore-step31-from-backup.sql refuses when the groups already exist (" + er2 + ")", !!er2 && /already exists/.test(er2));
  await db.exec("rollback");
  await db.exec("delete from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')");
}
// Step 26 left The Home Team in Coast2Coast Fitness (it was applied again after its undo): the group keeps its program and the coach.
{
    const moved = (await db.query("select organization_id from public.groups where id = '060017b5-e613-4204-a101-c6a14c3a9630'")).rows[0];
    check("step 26: The Home Team is in Coast2Coast Fitness and keeps its program and Ron as coach", moved.organization_id === "e369f4a7-c53a-4532-95d3-f7bd14e40e48" && (await db.query("select count(*)::int as n from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630'")).rows[0].n >= 1 && (await db.query("select count(*)::int as n from public.group_memberships where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and role = 'coach'")).rows[0].n === 1);
  }
// Release O fix (steps 52 and 53): ONE paste. From the state the live database is in (the notice function and the 46 trigger functions open to signed-in users) it closes all of
// them, a second run is refused naming step 52, the undo files (53 then 52) open them again exactly, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-o2");
  check("release-o2: ONE bundle holds steps 52 and 53 in that order", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["52", "53"]) && !bundles.some((b) => b.id === "release-o3"));
  const st52 = steps.find((x) => x.n === "52");
  const st53 = steps.find((x) => x.n === "53");
  const names = ["notify_on_target_change", ...TRIGGER_SWEEP];
  const openCount = async () => (await db.query("select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and p.proname = any ($1) and has_function_privilege('authenticated', p.oid, 'execute')", [names])).rows[0].n;
  for (const n of names) await db.exec(`do $o$ begin if to_regprocedure('public.${n}()') is not null then grant execute on function public.${n}() to authenticated; end if; end $o$`);
  const before = await openCount();
  check("release-o2: before it runs, the notice function and the trigger functions are open to signed-in users (" + before + ")", before > 40);
  const err = await run(`apply/${bundle.file}`);
  check("release-o2 bundle applies on the live-shaped state" + (err ? ": " + err : ""), !err);
  check("release-o2: afterwards none of them can be run by a signed-in user", (await openCount()) === 0);
  const again = await run(`apply/${bundle.file}`);
  check("release-o2: a second run is refused, naming step 52 (" + again + ")", !!again && again.includes("step 52 (0307) cannot run") && again.includes("already applied"));
  const e53 = await run(`apply/undo-step${st53.n}-${st53.slug}.sql`);
  const e52 = await run(`apply/undo-step${st52.n}-${st52.slug}.sql`);
  check("release-o2: the undo files (53 then 52) run" + (e53 || e52 ? ": " + (e53 || e52) : ""), !e53 && !e52);
  check("release-o2: after the undo they are open to signed-in users again, exactly as before (" + before + ")", (await openCount()) === before);
  const err2 = await run(`apply/${bundle.file}`);
  check("release-o2: the bundle applies again after an undo" + (err2 ? ": " + err2 : ""), !err2 && (await openCount()) === 0);
}
// Release Q (step 55): ONE paste. The display_name column is not there before, the bundle adds it (its quoting is valid even with an apostrophe in a name), a second run is refused naming
// step 55, the undo removes it, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-q");
  check("release-q: ONE bundle holds step 55", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["55"]));
  const st55 = steps.find((x) => x.n === "55");
  const hasCol = async () => (await db.query("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'display_name'")).rows[0].n === 1;
  // earlier tests applied 0310 by its own file; take it back so the bundle runs on the state live has
  const eu0 = await run(`apply/undo-step${st55.n}-${st55.slug}.sql`);
  check("release-q: the column is not there before the bundle runs" + (eu0 ? ": " + eu0 : ""), !eu0 && !(await hasCol()));
  const errQ = await run(`apply/${bundle.file}`);
  check("release-q bundle applies on the live-shaped state" + (errQ ? ": " + errQ : ""), !errQ && (await hasCol()));
  const againQ = await run(`apply/${bundle.file}`);
  check("release-q: a second run is refused, naming step 55 (" + againQ + ")", !!againQ && againQ.includes("step 55 (0310) cannot run") && againQ.includes("already applied"));
  const euQ = await run(`apply/undo-step${st55.n}-${st55.slug}.sql`);
  check("release-q: the undo removes the column" + (euQ ? ": " + euQ : ""), !euQ && !(await hasCol()));
  const errQ2 = await run(`apply/${bundle.file}`);
  check("release-q: the bundle applies again after an undo" + (errQ2 ? ": " + errQ2 : ""), !errQ2 && (await hasCol()));
}
// Release R (step 56): ONE paste. The tries table is not there before, the bundle adds it, a second run is refused naming step 56, the undo removes it, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-r");
  check("release-r: ONE bundle holds step 56", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["56"]));
  const st56 = steps.find((x) => x.n === "56");
  const hasTable = async () => (await db.query("select to_regclass('public.meal_plan_tries') is not null as ok")).rows[0].ok === true;
  const eu0 = await run(`apply/undo-step${st56.n}-${st56.slug}.sql`);
  check("release-r: the tries table is not there before the bundle runs" + (eu0 ? ": " + eu0 : ""), !eu0 && !(await hasTable()));
  const errR = await run(`apply/${bundle.file}`);
  check("release-r bundle applies on the live-shaped state" + (errR ? ": " + errR : ""), !errR && (await hasTable()));
  const againR = await run(`apply/${bundle.file}`);
  check("release-r: a second run is refused, naming step 56 (" + againR + ")", !!againR && againR.includes("step 56 (0311) cannot run") && againR.includes("already applied"));
  const euR = await run(`apply/undo-step${st56.n}-${st56.slug}.sql`);
  const typeGone = (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notifications_type_check'")).rows[0].d;
  check("release-r: the undo removes the table, the functions and the notification type, and keeps the older types" + (euR ? ": " + euR : ""), !euR && !(await hasTable()) && !/meal_plan_try/.test(typeGone) && /'comment'/.test(typeGone));
  const errR2 = await run(`apply/${bundle.file}`);
  check("release-r: the bundle applies again after an undo" + (errR2 ? ": " + errR2 : ""), !errR2 && (await hasTable()));
}
// Release S (steps so far: 57): ONE paste. The booking functions do not check the hours before, the bundle adds the check, a second run is refused naming step 57, the undo takes it out again, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-s");
  check("release-s: ONE bundle exists and starts with step 57", !!bundle && bundle.steps[0] === "57");
  const st58 = steps.find((x) => x.n === "58");
  const st59 = steps.find((x) => x.n === "59");
  const st60 = steps.find((x) => x.n === "60");
  const hasAway = async () => (await db.query("select to_regclass('public.coach_away_replies') is not null as ok")).rows[0].ok === true;
  const hasUi = async () => (await db.query("select to_regclass('public.client_ui_settings') is not null as ok")).rows[0].ok === true;
  const hasCounts = async () => (await db.query("select to_regprocedure('public.booking_counts(uuid, uuid, uuid[], uuid)') is not null as ok")).rows[0].ok === true;
  const st57 = steps.find((x) => x.n === "57");
  const checksHours = async () => (await db.query("select position('coach_time_is_open' in pg_get_functiondef(p.oid)) > 0 as ok from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace")).rows[0].ok === true;
  const eu0d = await run(`apply/undo-step${st60.n}-${st60.slug}.sql`);
  const eu0c = await run(`apply/undo-step${st59.n}-${st59.slug}.sql`);
  const eu0b = await run(`apply/undo-step${st58.n}-${st58.slug}.sql`);
  const eu0 = await run(`apply/undo-step${st57.n}-${st57.slug}.sql`);
  check("release-s: before the bundle runs, book_session does not check the hours and booking_counts is not there" + (eu0b ? ": " + eu0b : ""), !eu0b && !eu0c && !eu0d && !(await hasCounts()) && !(await hasUi()) && !(await hasAway()));
  check("release-s: (undo of 57) book_session does not check the hours" + (eu0 ? ": " + eu0 : ""), !eu0 && !(await checksHours()));
  const errS = await run(`apply/${bundle.file}`);
  check("release-s bundle applies on the live-shaped state" + (errS ? ": " + errS : ""), !errS && (await checksHours()) && (await hasCounts()) && (await hasUi()) && (await hasAway()));
  const againS = await run(`apply/${bundle.file}`);
  check("release-s: a second run is refused, naming step 57 (" + againS + ")", !!againS && againS.includes("step 57 (0312) cannot run") && againS.includes("already applied"));
  const euS4 = await run(`apply/undo-step${st60.n}-${st60.slug}.sql`);
  const euS3 = await run(`apply/undo-step${st59.n}-${st59.slug}.sql`);
  const euS2 = await run(`apply/undo-step${st58.n}-${st58.slug}.sql`);
  const euS = await run(`apply/undo-step${st57.n}-${st57.slug}.sql`);
  check("release-s: the undo (58 then 57) puts book_session back without the hours check and removes booking_counts" + (euS || euS2 || euS3 || euS4 ? ": " + (euS || euS2 || euS3 || euS4) : ""), !euS && !euS2 && !euS3 && !euS4 && !(await checksHours()) && !(await hasCounts()) && !(await hasUi()) && !(await hasAway()));
  const errS2 = await run(`apply/${bundle.file}`);
  check("release-s: the bundle applies again after an undo" + (errS2 ? ": " + errS2 : ""), !errS2 && (await checksHours()) && (await hasCounts()) && (await hasUi()) && (await hasAway()));
}
// Release T (step 61): ONE paste. The source column is not there before, the bundle adds it and the copy function stores it, a second run is refused naming step 61, the undo removes the column
// and puts the copy function back, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-t");
  check("release-t: ONE bundle starts with step 61", !!bundle && bundle.steps[0] === "61");
  const st61 = steps.find((x) => x.n === "61");
  const st62 = steps.find((x) => x.n === "62");
  const hasAccess = async () => (await db.query("select to_regclass('public.package_group_access') is not null as ok")).rows[0].ok === true;
  const hasCol = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'source_program_id') as ok")).rows[0].ok === true;
  const storesSource = async () => (await db.query("select position('ai_sequencing_notes, source_program_id' in pg_get_functiondef(p.oid)) > 0 as ok from pg_proc p where p.proname = 'duplicate_program' and p.pronamespace = 'public'::regnamespace")).rows[0].ok === true;
  const eu0b = await run(`apply/undo-step${st62.n}-${st62.slug}.sql`);
  const eu0 = await run(`apply/undo-step${st61.n}-${st61.slug}.sql`);
  check("release-t: before the bundle runs there is no source column and no group access" + (eu0 ? ": " + eu0 : ""), !eu0 && !eu0b && !(await hasCol()) && !(await storesSource()) && !(await hasAccess()));
  const errT = await run(`apply/${bundle.file}`);
  check("release-t bundle applies on the live-shaped state" + (errT ? ": " + errT : ""), !errT && (await hasCol()) && (await storesSource()) && (await hasAccess()));
  const againT = await run(`apply/${bundle.file}`);
  check("release-t: a second run is refused, naming step 61 (" + againT + ")", !!againT && againT.includes("step 61 (0316) cannot run") && againT.includes("already applied"));
  const euT2 = await run(`apply/undo-step${st62.n}-${st62.slug}.sql`);
  const euT = await run(`apply/undo-step${st61.n}-${st61.slug}.sql`);
  check("release-t: the undo (62 then 61) removes the columns and the record and puts the copy function back" + (euT || euT2 ? ": " + (euT || euT2) : ""), !euT && !euT2 && !(await hasCol()) && !(await storesSource()) && !(await hasAccess()));
  const errT2 = await run(`apply/${bundle.file}`);
  check("release-t: the bundle applies again after an undo" + (errT2 ? ": " + errT2 : ""), !errT2 && (await hasCol()) && (await storesSource()) && (await hasAccess()));
}
// The paste channel garbles non-ASCII characters (a typed em dash became three odd characters in a live function), so no line of SQL in a paste file may contain one (comments are fine:
// they are never run). Steps already applied are listed and left alone.
{
  const { readdirSync } = await import("node:fs");
  const ALREADY_APPLIED = new Set(["apply-release-q-all.sql", "apply-step55-0310.sql", "undo-step55-0310.sql"]);
  const offenders = [];
  for (const f of readdirSync(new URL("../../supabase/apply/", import.meta.url))) {
    if (!f.endsWith(".sql") || ALREADY_APPLIED.has(f)) continue;
    const lines = readFileSync(new URL("../../supabase/apply/" + f, import.meta.url), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*--/.test(line)) return;
      if (/[^\x00-\x7f]/.test(line)) offenders.push(f + ":" + (i + 1));
    });
  }
  check("no paste or undo file has a non-ASCII character outside a comment" + (offenders.length ? ": " + offenders.slice(0, 6).join(", ") : ""), offenders.length === 0);
}
// Release U (step 63): ONE paste. The copy function does not strip a client tail before, the bundle makes it, a second run is refused naming step 63, the undo puts the older function back, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-u");
  check("release-u: ONE bundle holds step 63", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["63"]));
  const st63 = steps.find((x) => x.n === "63");
  const strips = async () => (await db.query("select position('v_tail' in prosrc) > 0 as ok from pg_proc where proname = 'duplicate_program' and pronamespace = 'public'::regnamespace")).rows[0].ok === true;
  const eu0 = await run(`apply/undo-step${st63.n}-${st63.slug}.sql`);
  check("release-u: before the bundle runs the copy function does not strip a client tail" + (eu0 ? ": " + eu0 : ""), !eu0 && !(await strips()));
  const errU = await run(`apply/${bundle.file}`);
  check("release-u bundle applies on the live-shaped state" + (errU ? ": " + errU : ""), !errU && (await strips()));
  const againU = await run(`apply/${bundle.file}`);
  check("release-u: a second run is refused, naming step 63 (" + againU + ")", !!againU && againU.includes("step 63 (0318) cannot run") && againU.includes("already applied"));
  const euU = await run(`apply/undo-step${st63.n}-${st63.slug}.sql`);
  check("release-u: the undo puts the older copy function back" + (euU ? ": " + euU : ""), !euU && !(await strips()));
  const errU2 = await run(`apply/${bundle.file}`);
  check("release-u: the bundle applies again after an undo" + (errU2 ? ": " + errU2 : ""), !errU2 && (await strips()));
}
// Release V (step 64): ONE paste. At this point step 64 is applied; take it back with its undo, then the bundle applies, a second run is refused naming step 64, the undo returns it, and it applies again.
// (Step 111 is newer and renames some of V's survivors, so it is taken back first and applied again after this block.)
await run("apply/undo-step111-catalog-merge-ron.sql");
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-v");
  check("release-v: ONE bundle holds step 64", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["64"]));
  const st64 = steps.find((x) => x.n === "64");
  const merged = async () => (await db.query("select to_regclass('public.exercise_merge_log') is not null as ok")).rows[0].ok === true;
  const eu0 = await run(`apply/undo-step${st64.n}-${st64.slug}.sql`);
  check("release-v: before the bundle runs nothing is merged" + (eu0 ? ": " + eu0 : ""), !eu0 && !(await merged()));
  const errV = await run(`apply/${bundle.file}`);
  check("release-v bundle applies on the live-shaped state" + (errV ? ": " + errV : ""), !errV && (await merged()));
  const againV = await run(`apply/${bundle.file}`);
  check("release-v: a second run is refused, naming step 64 (" + againV + ")", !!againV && againV.includes("step 64 (merge-duplicate-exercises) cannot run") && againV.includes("already applied"));
  const euV = await run(`apply/undo-step${st64.n}-${st64.slug}.sql`);
  check("release-v: the undo returns it" + (euV ? ": " + euV : ""), !euV && !(await merged()));
  const errV2 = await run(`apply/${bundle.file}`);
  check("release-v: the bundle applies again after an undo" + (errV2 ? ": " + errV2 : ""), !errV2 && (await merged()));
}
// Releases BP (step 110, the empty catalog) and BQ (step 111, Ron's names): one paste each. BQ is refused until BP is in, a second run is refused, the undo returns it, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bp = bundles.find((b) => b.id === "release-bp");
  const bq = bundles.find((b) => b.id === "release-bq");
  check("release-bp / release-bq: one bundle each (steps 110 and 111)", !!bp && !!bq && JSON.stringify(bp.steps) === JSON.stringify(["110"]) && JSON.stringify(bq.steps) === JSON.stringify(["111"]));
  const catalogThere = async () => (await db.query("select to_regclass('public.exercise_catalog') is not null as ok")).rows[0].ok === true;
  const catalogRows = async () => Number((await db.query("select count(*)::int as n from public.exercise_catalog")).rows[0].n);
  const euBP0 = await run("apply/undo-step110-0361.sql");
  check("release-bp: before the bundle runs there is no catalog" + (euBP0 ? ": " + euBP0 : ""), !euBP0 && !(await catalogThere()));
  const refusedBQ = await run(`apply/${bq.file}`);
  check("release-bq: refused with nothing changed while Release BP is not in", !!refusedBQ && refusedBQ.includes("cannot run") && !(await catalogThere()));
  const errBP = await run(`apply/${bp.file}`);
  check("release-bp bundle applies" + (errBP ? ": " + errBP : ""), !errBP && (await catalogThere()) && (await catalogRows()) === 0);
  const againBP = await run(`apply/${bp.file}`);
  check("release-bp: a second run is refused, naming step 110", !!againBP && againBP.includes("step 110 (0361) cannot run") && againBP.includes("already applied"));
  const errBQ = await run(`apply/${bq.file}`);
  check("release-bq bundle applies" + (errBQ ? ": " + errBQ : ""), !errBQ && (await catalogRows()) > 0);
  const againBQ = await run(`apply/${bq.file}`);
  check("release-bq: a second run is refused, naming step 111", !!againBQ && againBQ.includes("step 111 (catalog-merge-ron) cannot run") && againBQ.includes("already applied"));
  const euBQ = await run("apply/undo-step111-catalog-merge-ron.sql");
  check("release-bq: the undo empties the catalog again" + (euBQ ? ": " + euBQ : ""), !euBQ && (await catalogRows()) === 0);
  const errBQ2 = await run(`apply/${bq.file}`);
  check("release-bq: the bundle applies again after an undo" + (errBQ2 ? ": " + errBQ2 : ""), !errBQ2 && (await catalogRows()) > 0);
}
// Release W (step 65): ONE paste. The audit functions have no fixed search path before, the bundle pins them and closes rls_auto_enable, a second run is refused naming step 65, the undo puts it back, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-w");
  check("release-w: ONE bundle holds step 65", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["65"]));
  const st65 = steps.find((x) => x.n === "65");
  const pinned = async () => (await db.query("select proconfig is not null as ok from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure")).rows[0].ok === true;
  const helperOpen = async () => (await db.query("select to_regprocedure('public.rls_auto_enable()') is not null and has_function_privilege('anon', 'public.rls_auto_enable()', 'execute') as ok")).rows[0].ok === true;
  // The platform's own helper does not exist in this scratch database; stand one in with the live permissions so the revoke has something to close.
  await db.query("create or replace function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path to 'pg_catalog' as $$ begin null; end $$");
  await db.query("grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role");
  const ew0 = await run(`apply/undo-step${st65.n}-${st65.slug}.sql`);
  check("release-w: before the bundle runs audit_diff has no fixed search path and the helper is open" + (ew0 ? ": " + ew0 : ""), !ew0 && !(await pinned()) && (await helperOpen()));
  const errW = await run(`apply/${bundle.file}`);
  check("release-w bundle applies on the live-shaped state" + (errW ? ": " + errW : ""), !errW && (await pinned()) && !(await helperOpen()));
  const againW = await run(`apply/${bundle.file}`);
  check("release-w: a second run is refused, naming step 65 (" + againW + ")", !!againW && againW.includes("step 65 (0319) cannot run") && againW.includes("already applied"));
  const euW = await run(`apply/undo-step${st65.n}-${st65.slug}.sql`);
  check("release-w: the undo takes the search paths off and opens the helper again" + (euW ? ": " + euW : ""), !euW && !(await pinned()) && (await helperOpen()));
  const errW2 = await run(`apply/${bundle.file}`);
  check("release-w: the bundle applies again after an undo" + (errW2 ? ": " + errW2 : ""), !errW2 && (await pinned()) && !(await helperOpen()));
}
// Release X (step 66): ONE paste. The look rules are absent before, the bundle adds them, a second run is refused naming step 66, the undo removes them, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-x");
  check("release-x: ONE bundle holds step 66", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["66"]));
  const st66 = steps.find((x) => x.n === "66");
  const looks = async () => Number((await db.query("select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = any (array['org_branding_select_owner_admin', 'coach_profile_photos_select_own', 'pro_shop_images_select_own'])")).rows[0].n);
  const ex0 = await run(`apply/undo-step${st66.n}-${st66.slug}.sql`);
  check("release-x: before the bundle runs there are no look rules" + (ex0 ? ": " + ex0 : ""), !ex0 && (await looks()) === 0);
  const errX = await run(`apply/${bundle.file}`);
  check("release-x bundle applies on the live-shaped state" + (errX ? ": " + errX : ""), !errX && (await looks()) === 3);
  const againX = await run(`apply/${bundle.file}`);
  check("release-x: a second run is refused, naming step 66 (" + againX + ")", !!againX && againX.includes("step 66 (0320) cannot run") && againX.includes("already applied"));
  const euX = await run(`apply/undo-step${st66.n}-${st66.slug}.sql`);
  check("release-x: the undo removes the three rules" + (euX ? ": " + euX : ""), !euX && (await looks()) === 0);
  const errX2 = await run(`apply/${bundle.file}`);
  check("release-x: the bundle applies again after an undo" + (errX2 ? ": " + errX2 : ""), !errX2 && (await looks()) === 3);
}
// Release Y (step 67): ONE paste. No website table before, the bundle makes it, a second run is refused naming step 67, the undo drops it, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-y");
  check("release-y: ONE bundle holds step 67", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["67"]));
  const st67 = steps.find((x) => x.n === "67");
  const has = async () => (await db.query("select to_regclass('public.coach_sites') is not null as ok")).rows[0].ok === true;
  const ey0 = await run(`apply/undo-step${st67.n}-${st67.slug}.sql`);
  check("release-y: before the bundle runs there is no website table" + (ey0 ? ": " + ey0 : ""), !ey0 && !(await has()));
  const errY = await run(`apply/${bundle.file}`);
  check("release-y bundle applies on the live-shaped state" + (errY ? ": " + errY : ""), !errY && (await has()));
  const againY = await run(`apply/${bundle.file}`);
  check("release-y: a second run is refused, naming step 67 (" + againY + ")", !!againY && againY.includes("step 67 (0321) cannot run") && againY.includes("already applied"));
  const euY = await run(`apply/undo-step${st67.n}-${st67.slug}.sql`);
  check("release-y: the undo drops the website table" + (euY ? ": " + euY : ""), !euY && !(await has()));
  const errY2 = await run(`apply/${bundle.file}`);
  check("release-y: the bundle applies again after an undo" + (errY2 ? ": " + errY2 : ""), !errY2 && (await has()));
}
// Release Z (step 68): ONE paste. No clearing function before, the bundle makes it (server-only), a second run is refused naming step 68, the undo drops it, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-z");
  check("release-z: ONE bundle holds step 68", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["68"]));
  const st68 = steps.find((x) => x.n === "68");
  const has = async () => (await db.query("select to_regprocedure('public.detach_profile_references(uuid)') is not null as ok")).rows[0].ok === true;
  const ez0 = await run(`apply/undo-step${st68.n}-${st68.slug}.sql`);
  check("release-z: before the bundle runs there is no clearing function" + (ez0 ? ": " + ez0 : ""), !ez0 && !(await has()));
  const errZ = await run(`apply/${bundle.file}`);
  check("release-z bundle applies on the live-shaped state" + (errZ ? ": " + errZ : ""), !errZ && (await has()));
  const againZ = await run(`apply/${bundle.file}`);
  check("release-z: a second run is refused, naming step 68 (" + againZ + ")", !!againZ && againZ.includes("step 68 (0322) cannot run") && againZ.includes("already applied"));
  const euZ = await run(`apply/undo-step${st68.n}-${st68.slug}.sql`);
  check("release-z: the undo drops the functions" + (euZ ? ": " + euZ : ""), !euZ && !(await has()));
  const errZ2 = await run(`apply/${bundle.file}`);
  check("release-z: the bundle applies again after an undo" + (errZ2 ? ": " + errZ2 : ""), !errZ2 && (await has()));
}
// Defense in depth (steps 94 and 95) is taken off for the bundle tests that follow: some of them undo older steps that drop a column the rule's policies read. Its own test is further down.
// (the assessments table carries the same rule when it is installed, so it comes off first)
await run(`apply/undo-step104-0358.sql`);
await run(`apply/undo-step101-0355.sql`);
await run(`apply/undo-step95-0349.sql`);
await run(`apply/undo-step94-0348.sql`);
// Release AB (step 69): ONE paste. No event kind before, the bundle adds events (the class functions refuse them), a second run is refused naming step 69, the undo puts everything back, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ab");
  check("release-ab: ONE bundle holds step 69", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["69"]));
  const st69 = steps.find((x) => x.n === "69");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_sessions' and column_name = 'kind') as ok")).rows[0].ok === true;
  const eab0 = await run(`apply/undo-step${st69.n}-${st69.slug}.sql`);
  check("release-ab: before the bundle runs there is no event kind" + (eab0 ? ": " + eab0 : ""), !eab0 && !(await has()));
  const errAB = await run(`apply/${bundle.file}`);
  check("release-ab bundle applies on the live-shaped state" + (errAB ? ": " + errAB : ""), !errAB && (await has()));
  const againAB = await run(`apply/${bundle.file}`);
  check("release-ab: a second run is refused, naming step 69 (" + againAB + ")", !!againAB && againAB.includes("step 69 (0323) cannot run") && againAB.includes("already applied"));
  const euAB = await run(`apply/undo-step${st69.n}-${st69.slug}.sql`);
  check("release-ab: the undo removes the event kind" + (euAB ? ": " + euAB : ""), !euAB && !(await has()));
  const errAB2 = await run(`apply/${bundle.file}`);
  check("release-ab: the bundle applies again after an undo" + (errAB2 ? ": " + errAB2 : ""), !errAB2 && (await has()));
}
// Release AC (step 70): ONE paste. No draft flag before, the bundle adds it with its guard, a second run is refused naming step 70, the undo removes it, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ac");
  check("release-ac: ONE bundle holds step 70", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["70"]));
  const st70 = steps.find((x) => x.n === "70");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'ai_draft') as ok")).rows[0].ok === true;
  const eac0 = await run(`apply/undo-step${st70.n}-${st70.slug}.sql`);
  check("release-ac: before the bundle runs there is no draft flag" + (eac0 ? ": " + eac0 : ""), !eac0 && !(await has()));
  const errAC = await run(`apply/${bundle.file}`);
  check("release-ac bundle applies on the live-shaped state" + (errAC ? ": " + errAC : ""), !errAC && (await has()));
  const againAC = await run(`apply/${bundle.file}`);
  check("release-ac: a second run is refused, naming step 70 (" + againAC + ")", !!againAC && againAC.includes("step 70 (0324) cannot run") && againAC.includes("already applied"));
  const euAC = await run(`apply/undo-step${st70.n}-${st70.slug}.sql`);
  check("release-ac: the undo removes the draft flag" + (euAC ? ": " + euAC : ""), !euAC && !(await has()));
  const errAC2 = await run(`apply/${bundle.file}`);
  check("release-ac: the bundle applies again after an undo" + (errAC2 ? ": " + errAC2 : ""), !errAC2 && (await has()));
}
// Release AD (step 71): ONE paste, after Release AC. No snapshot column before, the bundle adds the learning tables, a second run is refused naming step 71, the undo removes them, and it applies again.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ad");
  check("release-ad: ONE bundle holds step 71", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["71"]));
  const st71 = steps.find((x) => x.n === "71");
  const has = async () => (await db.query("select to_regclass('public.coach_learned_rules') is not null as ok")).rows[0].ok === true;
  const ead0 = await run(`apply/undo-step${st71.n}-${st71.slug}.sql`);
  check("release-ad: before the bundle runs there are no learning tables" + (ead0 ? ": " + ead0 : ""), !ead0 && !(await has()));
  const errAD = await run(`apply/${bundle.file}`);
  check("release-ad bundle applies on the live-shaped state" + (errAD ? ": " + errAD : ""), !errAD && (await has()));
  const againAD = await run(`apply/${bundle.file}`);
  check("release-ad: a second run is refused, naming step 71 (" + againAD + ")", !!againAD && againAD.includes("step 71 (0325) cannot run") && againAD.includes("already applied"));
  const euAD = await run(`apply/undo-step${st71.n}-${st71.slug}.sql`);
  check("release-ad: the undo removes the learning tables" + (euAD ? ": " + euAD : ""), !euAD && !(await has()));
  const errAD2 = await run(`apply/${bundle.file}`);
  check("release-ad: the bundle applies again after an undo" + (errAD2 ? ": " + errAD2 : ""), !errAD2 && (await has()));
}
// Release AE (step 72): ONE paste, after Release AD.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ae");
  check("release-ae: ONE bundle holds step 72", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["72"]));
  const st72 = steps.find((x) => x.n === "72");
  const has = async () => (await db.query("select to_regclass('public.coach_conversations') is not null as ok")).rows[0].ok === true;
  const eae0 = await run(`apply/undo-step${st72.n}-${st72.slug}.sql`);
  check("release-ae: before the bundle runs there is no conversation table" + (eae0 ? ": " + eae0 : ""), !eae0 && !(await has()));
  const errAE = await run(`apply/${bundle.file}`);
  check("release-ae bundle applies on the live-shaped state" + (errAE ? ": " + errAE : ""), !errAE && (await has()));
  const againAE = await run(`apply/${bundle.file}`);
  check("release-ae: a second run is refused, naming step 72 (" + againAE + ")", !!againAE && againAE.includes("step 72 (0326) cannot run") && againAE.includes("already applied"));
  const euAE = await run(`apply/undo-step${st72.n}-${st72.slug}.sql`);
  check("release-ae: the undo removes the conversation tables" + (euAE ? ": " + euAE : ""), !euAE && !(await has()));
  const errAE2 = await run(`apply/${bundle.file}`);
  check("release-ae: the bundle applies again after an undo" + (errAE2 ? ": " + errAE2 : ""), !errAE2 && (await has()));
}
// Release AF (step 73): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-af");
  check("release-af: ONE bundle holds step 73", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["73"]));
  const st73 = steps.find((x) => x.n === "73");
  const has = async () => (await db.query("select to_regclass('public.coach_message_templates') is not null as ok")).rows[0].ok === true;
  const eaf0 = await run(`apply/undo-step${st73.n}-${st73.slug}.sql`);
  check("release-af: before the bundle runs there is no template table" + (eaf0 ? ": " + eaf0 : ""), !eaf0 && !(await has()));
  const errAF = await run(`apply/${bundle.file}`);
  check("release-af bundle applies on the live-shaped state" + (errAF ? ": " + errAF : ""), !errAF && (await has()));
  const againAF = await run(`apply/${bundle.file}`);
  check("release-af: a second run is refused, naming step 73 (" + againAF + ")", !!againAF && againAF.includes("step 73 (0327) cannot run") && againAF.includes("already applied"));
  const euAF = await run(`apply/undo-step${st73.n}-${st73.slug}.sql`);
  check("release-af: the undo removes the template table" + (euAF ? ": " + euAF : ""), !euAF && !(await has()));
  const errAF2 = await run(`apply/${bundle.file}`);
  check("release-af: the bundle applies again after an undo" + (errAF2 ? ": " + errAF2 : ""), !errAF2 && (await has()));
}
// Release AG (step 74): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ag");
  check("release-ag: ONE bundle holds step 74", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["74"]));
  const st74 = steps.find((x) => x.n === "74");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'archived_at') as ok")).rows[0].ok === true;
  const eag0 = await run(`apply/undo-step${st74.n}-${st74.slug}.sql`);
  check("release-ag: before the bundle runs there is no archived_at column" + (eag0 ? ": " + eag0 : ""), !eag0 && !(await has()));
  const errAG = await run(`apply/${bundle.file}`);
  check("release-ag bundle applies on the live-shaped state" + (errAG ? ": " + errAG : ""), !errAG && (await has()));
  const againAG = await run(`apply/${bundle.file}`);
  check("release-ag: a second run is refused, naming step 74 (" + againAG + ")", !!againAG && againAG.includes("step 74 (0328) cannot run") && againAG.includes("already applied"));
  const euAG = await run(`apply/undo-step${st74.n}-${st74.slug}.sql`);
  check("release-ag: the undo removes the column" + (euAG ? ": " + euAG : ""), !euAG && !(await has()));
  const errAG2 = await run(`apply/${bundle.file}`);
  check("release-ag: the bundle applies again after an undo" + (errAG2 ? ": " + errAG2 : ""), !errAG2 && (await has()));
}
// Release AA (step 75): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-aa");
  check("release-aa: ONE bundle holds step 75", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["75"]));
  const st75 = steps.find((x) => x.n === "75");
  const has = async () => (await db.query("select exists (select 1 from pg_constraint where conname = 'session_types_credit_cost_is_one') as ok")).rows[0].ok === true;
  const eaa0 = await run(`apply/undo-step${st75.n}-${st75.slug}.sql`);
  check("release-aa: before the bundle runs the cost rule is absent" + (eaa0 ? ": " + eaa0 : ""), !eaa0 && !(await has()));
  const errAA = await run(`apply/${bundle.file}`);
  check("release-aa bundle applies on the live-shaped state" + (errAA ? ": " + errAA : ""), !errAA && (await has()));
  const againAA = await run(`apply/${bundle.file}`);
  check("release-aa: a second run is refused, naming step 75 (" + againAA + ")", !!againAA && againAA.includes("step 75 (0329) cannot run") && againAA.includes("already applied"));
  const euAA = await run(`apply/undo-step${st75.n}-${st75.slug}.sql`);
  check("release-aa: the undo removes the rule and puts both functions back" + (euAA ? ": " + euAA : ""), !euAA && !(await has()));
  const back = (await db.query("select prosrc from pg_proc where proname = 'complete_workout_session' and pronamespace = 'public'::regnamespace")).rows[0].prosrc;
  check("release-aa: after the undo completing a workout reads the type cost again", /select credit_cost into v_credit_cost/.test(back));
  const errAA2 = await run(`apply/${bundle.file}`);
  check("release-aa: the bundle applies again after an undo" + (errAA2 ? ": " + errAA2 : ""), !errAA2 && (await has()));
}
// Release AH (step 76): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ah");
  check("release-ah: ONE bundle holds step 76", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["76"]));
  const st76 = steps.find((x) => x.n === "76");
  const has = async () => (await db.query("select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_sites' and policyname = 'coach_sites_own' and with_check like '%group_memberships%') as ok")).rows[0].ok === true;
  const eah0 = await run(`apply/undo-step${st76.n}-${st76.slug}.sql`);
  check("release-ah: before the bundle runs the rule has no coaching check" + (eah0 ? ": " + eah0 : ""), !eah0 && !(await has()));
  const errAH = await run(`apply/${bundle.file}`);
  check("release-ah bundle applies on the live-shaped state" + (errAH ? ": " + errAH : ""), !errAH && (await has()));
  const againAH = await run(`apply/${bundle.file}`);
  check("release-ah: a second run is refused, naming step 76 (" + againAH + ")", !!againAH && againAH.includes("step 76 (0330) cannot run") && againAH.includes("already applied"));
  const euAH = await run(`apply/undo-step${st76.n}-${st76.slug}.sql`);
  check("release-ah: the undo puts the rules back" + (euAH ? ": " + euAH : ""), !euAH && !(await has()));
  const errAH2 = await run(`apply/${bundle.file}`);
  check("release-ah: the bundle applies again after an undo" + (errAH2 ? ": " + errAH2 : ""), !errAH2 && (await has()));
}
// Release AI (step 77): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ai");
  check("release-ai: ONE bundle holds step 77", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["77"]));
  const st77 = steps.find((x) => x.n === "77");
  const has = async () => (await db.query("select to_regprocedure('public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)') is not null as ok")).rows[0].ok === true;
  const eai0 = await run(`apply/undo-step${st77.n}-${st77.slug}.sql`);
  check("release-ai: before the bundle runs the functions are absent" + (eai0 ? ": " + eai0 : ""), !eai0 && !(await has()));
  const errAI = await run(`apply/${bundle.file}`);
  check("release-ai bundle applies on the live-shaped state" + (errAI ? ": " + errAI : ""), !errAI && (await has()));
  const againAI = await run(`apply/${bundle.file}`);
  check("release-ai: a second run is refused, naming step 77 (" + againAI + ")", !!againAI && againAI.includes("step 77 (0331) cannot run") && againAI.includes("already applied"));
  const euAI = await run(`apply/undo-step${st77.n}-${st77.slug}.sql`);
  check("release-ai: the undo removes the functions" + (euAI ? ": " + euAI : ""), !euAI && !(await has()));
  const errAI2 = await run(`apply/${bundle.file}`);
  check("release-ai: the bundle applies again after an undo" + (errAI2 ? ": " + errAI2 : ""), !errAI2 && (await has()));
}
// Release AJ (step 78): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-aj");
  check("release-aj: ONE bundle holds step 78", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["78"]));
  const st78 = steps.find((x) => x.n === "78");
  const has = async () => (await db.query("select to_regprocedure('public.is_one_on_one_group(uuid)') is not null as ok")).rows[0].ok === true;
  const eaj0 = await run(`apply/undo-step${st78.n}-${st78.slug}.sql`);
  check("release-aj: before the bundle runs the helper is absent" + (eaj0 ? ": " + eaj0 : ""), !eaj0 && !(await has()));
  const errAJ = await run(`apply/${bundle.file}`);
  check("release-aj bundle applies on the live-shaped state" + (errAJ ? ": " + errAJ : ""), !errAJ && (await has()));
  const againAJ = await run(`apply/${bundle.file}`);
  check("release-aj: a second run is refused, naming step 78 (" + againAJ + ")", !!againAJ && againAJ.includes("step 78 (0332) cannot run") && againAJ.includes("already applied"));
  const euAJ = await run(`apply/undo-step${st78.n}-${st78.slug}.sql`);
  check("release-aj: the undo puts the rule back" + (euAJ ? ": " + euAJ : ""), !euAJ && !(await has()));
  const errAJ2 = await run(`apply/${bundle.file}`);
  check("release-aj: the bundle applies again after an undo" + (errAJ2 ? ": " + errAJ2 : ""), !errAJ2 && (await has()));
}
// Release AK (step 79): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ak");
  check("release-ak: ONE bundle holds step 79", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["79"]));
  const st79 = steps.find((x) => x.n === "79");
  const has = async () => (await db.query("select to_regprocedure('public.one_on_one_athlete(uuid)') is not null as ok")).rows[0].ok === true;
  const eak0 = await run(`apply/undo-step${st79.n}-${st79.slug}.sql`);
  check("release-ak: before the bundle runs the helper is absent" + (eak0 ? ": " + eak0 : ""), !eak0 && !(await has()));
  const errAK = await run(`apply/${bundle.file}`);
  check("release-ak bundle applies on the live-shaped state" + (errAK ? ": " + errAK : ""), !errAK && (await has()));
  const againAK = await run(`apply/${bundle.file}`);
  check("release-ak: a second run is refused, naming step 79 (" + againAK + ")", !!againAK && againAK.includes("step 79 (0333) cannot run") && againAK.includes("already applied"));
  const euAK = await run(`apply/undo-step${st79.n}-${st79.slug}.sql`);
  check("release-ak: the undo puts the rules back" + (euAK ? ": " + euAK : ""), !euAK && !(await has()));
  const errAK2 = await run(`apply/${bundle.file}`);
  check("release-ak: the bundle applies again after an undo" + (errAK2 ? ": " + errAK2 : ""), !errAK2 && (await has()));
}
// Release AL (step 80): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-al");
  check("release-al: ONE bundle holds step 80", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["80"]));
  const st80 = steps.find((x) => x.n === "80");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'show_name_on_share') as ok")).rows[0].ok === true;
  const eal0 = await run(`apply/undo-step${st80.n}-${st80.slug}.sql`);
  check("release-al: before the bundle runs the column is absent" + (eal0 ? ": " + eal0 : ""), !eal0 && !(await has()));
  const errAL = await run(`apply/${bundle.file}`);
  check("release-al bundle applies on the live-shaped state" + (errAL ? ": " + errAL : ""), !errAL && (await has()));
  const againAL = await run(`apply/${bundle.file}`);
  check("release-al: a second run is refused, naming step 80 (" + againAL + ")", !!againAL && againAL.includes("step 80 (0334) cannot run") && againAL.includes("already applied"));
  const euAL = await run(`apply/undo-step${st80.n}-${st80.slug}.sql`);
  check("release-al: the undo removes the column" + (euAL ? ": " + euAL : ""), !euAL && !(await has()));
  const errAL2 = await run(`apply/${bundle.file}`);
  check("release-al: the bundle applies again after an undo" + (errAL2 ? ": " + errAL2 : ""), !errAL2 && (await has()));
}
// Release AM (step 81): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-am");
  check("release-am: ONE bundle holds step 81", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["81"]));
  const st81 = steps.find((x) => x.n === "81");
  const has = async () => (await db.query("select to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is not null as ok")).rows[0].ok === true;
  const eam0 = await run(`apply/undo-step${st81.n}-${st81.slug}.sql`);
  check("release-am: before the bundle runs the function is absent" + (eam0 ? ": " + eam0 : ""), !eam0 && !(await has()));
  const errAM = await run(`apply/${bundle.file}`);
  check("release-am bundle applies on the live-shaped state" + (errAM ? ": " + errAM : ""), !errAM && (await has()));
  const againAM = await run(`apply/${bundle.file}`);
  check("release-am: a second run is refused, naming step 81 (" + againAM + ")", !!againAM && againAM.includes("step 81 (0335) cannot run") && againAM.includes("already applied"));
  const euAM = await run(`apply/undo-step${st81.n}-${st81.slug}.sql`);
  check("release-am: the undo removes the function" + (euAM ? ": " + euAM : ""), !euAM && !(await has()));
  const errAM2 = await run(`apply/${bundle.file}`);
  check("release-am: the bundle applies again after an undo" + (errAM2 ? ": " + errAM2 : ""), !errAM2 && (await has()));
}
// Release AN (step 82): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-an");
  check("release-an: ONE bundle holds step 82", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["82"]));
  const st82 = steps.find((x) => x.n === "82");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'terminology_asked_at') as ok")).rows[0].ok === true;
  const ean0 = await run(`apply/undo-step${st82.n}-${st82.slug}.sql`);
  check("release-an: before the bundle runs the column is absent" + (ean0 ? ": " + ean0 : ""), !ean0 && !(await has()));
  const errAN = await run(`apply/${bundle.file}`);
  check("release-an bundle applies on the live-shaped state" + (errAN ? ": " + errAN : ""), !errAN && (await has()));
  const againAN = await run(`apply/${bundle.file}`);
  check("release-an: a second run is refused, naming step 82 (" + againAN + ")", !!againAN && againAN.includes("step 82 (0336) cannot run") && againAN.includes("already applied"));
  const euAN = await run(`apply/undo-step${st82.n}-${st82.slug}.sql`);
  check("release-an: the undo removes the column" + (euAN ? ": " + euAN : ""), !euAN && !(await has()));
  const errAN2 = await run(`apply/${bundle.file}`);
  check("release-an: the bundle applies again after an undo" + (errAN2 ? ": " + errAN2 : ""), !errAN2 && (await has()));
}
// Release AO (step 83): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ao");
  check("release-ao: ONE bundle holds step 83", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["83"]));
  const st83 = steps.find((x) => x.n === "83");
  const has = async () => (await db.query("select position('v_src_org' in pg_get_functiondef(to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)'))) > 0 as ok")).rows[0].ok === true;
  const eao0 = await run(`apply/undo-step${st83.n}-${st83.slug}.sql`);
  check("release-ao: before the bundle runs the function has no organization check" + (eao0 ? ": " + eao0 : ""), !eao0 && !(await has()));
  const errAO = await run(`apply/${bundle.file}`);
  check("release-ao bundle applies on the live-shaped state" + (errAO ? ": " + errAO : ""), !errAO && (await has()));
  const againAO = await run(`apply/${bundle.file}`);
  check("release-ao: a second run is refused, naming step 83 (" + againAO + ")", !!againAO && againAO.includes("step 83 (0337) cannot run") && againAO.includes("already applied"));
  const euAO = await run(`apply/undo-step${st83.n}-${st83.slug}.sql`);
  check("release-ao: the undo puts back the earlier function" + (euAO ? ": " + euAO : ""), !euAO && !(await has()));
  const errAO2 = await run(`apply/${bundle.file}`);
  check("release-ao: the bundle applies again after an undo" + (errAO2 ? ": " + errAO2 : ""), !errAO2 && (await has()));
}
// Release AP (step 84): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ap");
  check("release-ap: ONE bundle holds step 84", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["84"]));
  const st84 = steps.find((x) => x.n === "84");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'guardian_links' and column_name = 'expires_at') as ok")).rows[0].ok === true;
  const eap0 = await run(`apply/undo-step${st84.n}-${st84.slug}.sql`);
  check("release-ap: before the bundle runs the old rule is back" + (eap0 ? ": " + eap0 : ""), !eap0);
  await db.exec("alter table public.guardian_links drop column if exists expires_at");
  const errAP = await run(`apply/${bundle.file}`);
  check("release-ap bundle applies on the live-shaped state" + (errAP ? ": " + errAP : ""), !errAP && (await has()));
  const againAP = await run(`apply/${bundle.file}`);
  check("release-ap: a second run is refused, naming step 84 (" + againAP + ")", !!againAP && againAP.includes("step 84 (0338) cannot run") && againAP.includes("already applied"));
  const euAP = await run(`apply/undo-step${st84.n}-${st84.slug}.sql`);
  check("release-ap: the undo puts the old rule back" + (euAP ? ": " + euAP : ""), !euAP);
  await db.exec("alter table public.guardian_links drop column if exists expires_at");
  const errAP2 = await run(`apply/${bundle.file}`);
  check("release-ap: the bundle applies again after an undo" + (errAP2 ? ": " + errAP2 : ""), !errAP2 && (await has()));
}
// Release AQ (step 85): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-aq");
  check("release-aq: ONE bundle holds step 85", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["85"]));
  const st85 = steps.find((x) => x.n === "85");
  const has = async () => (await db.query("select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_insert_own') as ok")).rows[0].ok === true;
  const eaq0 = await run(`apply/undo-step${st85.n}-${st85.slug}.sql`);
  check("release-aq: before the bundle runs the old rule is back" + (eaq0 ? ": " + eaq0 : ""), !eaq0 && !(await has()));
  const errAQ = await run(`apply/${bundle.file}`);
  check("release-aq bundle applies on the live-shaped state" + (errAQ ? ": " + errAQ : ""), !errAQ && (await has()));
  const againAQ = await run(`apply/${bundle.file}`);
  check("release-aq: a second run is refused, naming step 85 (" + againAQ + ")", !!againAQ && againAQ.includes("step 85 (0339) cannot run") && againAQ.includes("already applied"));
  const euAQ = await run(`apply/undo-step${st85.n}-${st85.slug}.sql`);
  check("release-aq: the undo puts the old rule back" + (euAQ ? ": " + euAQ : ""), !euAQ && !(await has()));
  const errAQ2 = await run(`apply/${bundle.file}`);
  check("release-aq: the bundle applies again after an undo" + (errAQ2 ? ": " + errAQ2 : ""), !errAQ2 && (await has()));
}
// Release AR (step 86): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ar");
  check("release-ar: ONE bundle holds step 86", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["86"]));
  const st86 = steps.find((x) => x.n === "86");
  const has = async () => (await db.query("select to_regprocedure('public.enforce_athlete_in_group()') is not null as ok")).rows[0].ok === true;
  const ear0 = await run(`apply/undo-step${st86.n}-${st86.slug}.sql`);
  check("release-ar: before the bundle runs the rule is absent" + (ear0 ? ": " + ear0 : ""), !ear0 && !(await has()));
  const errAR = await run(`apply/${bundle.file}`);
  check("release-ar bundle applies on the live-shaped state" + (errAR ? ": " + errAR : ""), !errAR && (await has()));
  const againAR = await run(`apply/${bundle.file}`);
  check("release-ar: a second run is refused, naming step 86 (" + againAR + ")", !!againAR && againAR.includes("step 86 (0340) cannot run") && againAR.includes("already applied"));
  const euAR = await run(`apply/undo-step${st86.n}-${st86.slug}.sql`);
  check("release-ar: the undo removes the rule" + (euAR ? ": " + euAR : ""), !euAR && !(await has()));
  const errAR2 = await run(`apply/${bundle.file}`);
  check("release-ar: the bundle applies again after an undo" + (errAR2 ? ": " + errAR2 : ""), !errAR2 && (await has()));
  // Leave the rule off again: later releases' undo files drop helpers (is_one_on_one_group) that its policies depend on.
  const euAR2 = await run(`apply/undo-step${st86.n}-${st86.slug}.sql`);
  check("release-ar: the undo runs again at the end" + (euAR2 ? ": " + euAR2 : ""), !euAR2);
}
// Release AS (step 87): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-as");
  check("release-as: ONE bundle holds step 87", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["87"]));
  const st87 = steps.find((x) => x.n === "87");
  const has = async () => (await db.query("select not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_insert_coach') as ok")).rows[0].ok === true;
  const eas0 = await run(`apply/undo-step${st87.n}-${st87.slug}.sql`);
  check("release-as: before the bundle runs the old write rules are back" + (eas0 ? ": " + eas0 : ""), !eas0 && !(await has()));
  const errAS = await run(`apply/${bundle.file}`);
  check("release-as bundle applies on the live-shaped state" + (errAS ? ": " + errAS : ""), !errAS && (await has()));
  const againAS = await run(`apply/${bundle.file}`);
  check("release-as: a second run is refused, naming step 87 (" + againAS + ")", !!againAS && againAS.includes("step 87 (0341) cannot run") && againAS.includes("already applied"));
  const euAS = await run(`apply/undo-step${st87.n}-${st87.slug}.sql`);
  check("release-as: the undo puts the old rules back" + (euAS ? ": " + euAS : ""), !euAS && !(await has()));
  const errAS2 = await run(`apply/${bundle.file}`);
  check("release-as: the bundle applies again after an undo" + (errAS2 ? ": " + errAS2 : ""), !errAS2 && (await has()));
}
// Release AT (step 88): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-at");
  check("release-at: ONE bundle holds step 88", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["88"]));
  const st88 = steps.find((x) => x.n === "88");
  const has = async () => (await db.query("select not has_function_privilege('authenticated', 'public.coach_ai_multiplier(uuid)', 'execute') as ok")).rows[0].ok === true;
  const eat0 = await run(`apply/undo-step${st88.n}-${st88.slug}.sql`);
  check("release-at: before the bundle runs the old functions are back" + (eat0 ? ": " + eat0 : ""), !eat0 && !(await has()));
  const errAT = await run(`apply/${bundle.file}`);
  check("release-at bundle applies on the live-shaped state" + (errAT ? ": " + errAT : ""), !errAT && (await has()));
  const againAT = await run(`apply/${bundle.file}`);
  check("release-at: a second run is refused, naming step 88 (" + againAT + ")", !!againAT && againAT.includes("step 88 (0342) cannot run") && againAT.includes("already applied"));
  const euAT = await run(`apply/undo-step${st88.n}-${st88.slug}.sql`);
  check("release-at: the undo puts the old functions back" + (euAT ? ": " + euAT : ""), !euAT && !(await has()));
  const errAT2 = await run(`apply/${bundle.file}`);
  check("release-at: the bundle applies again after an undo" + (errAT2 ? ": " + errAT2 : ""), !errAT2 && (await has()));
}
// Release AU (step 89): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-au");
  check("release-au: ONE bundle holds step 89", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["89"]));
  const st89 = steps.find((x) => x.n === "89");
  const has = async () => (await db.query("select to_regprocedure('public.grant_coach_credit_pack_once(text, text, uuid, integer, integer)') is not null as ok")).rows[0].ok === true;
  const eau0 = await run(`apply/undo-step${st89.n}-${st89.slug}.sql`);
  check("release-au: before the bundle runs the functions are absent" + (eau0 ? ": " + eau0 : ""), !eau0 && !(await has()));
  const errAU = await run(`apply/${bundle.file}`);
  check("release-au bundle applies on the live-shaped state" + (errAU ? ": " + errAU : ""), !errAU && (await has()));
  const againAU = await run(`apply/${bundle.file}`);
  check("release-au: a second run is refused, naming step 89 (" + againAU + ")", !!againAU && againAU.includes("step 89 (0343) cannot run") && againAU.includes("already applied"));
  const euAU = await run(`apply/undo-step${st89.n}-${st89.slug}.sql`);
  check("release-au: the undo removes the functions" + (euAU ? ": " + euAU : ""), !euAU && !(await has()));
  const errAU2 = await run(`apply/${bundle.file}`);
  check("release-au: the bundle applies again after an undo" + (errAU2 ? ": " + errAU2 : ""), !errAU2 && (await has()));
}
// Release AV (step 90): ONE paste; needs Release AR's function, so it is applied on top of it and left as it was.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-av");
  check("release-av: ONE bundle holds step 90", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["90"]));
  const st90 = steps.find((x) => x.n === "90");
  const has = async () => (await db.query("select position('v_had_row' in pg_get_functiondef(to_regprocedure('public.enforce_athlete_in_group()'))) > 0 as ok")).rows[0].ok === true;
  const arBundle = bundles.find((b) => b.id === "release-ar");
  const st86 = steps.find((x) => x.n === "86");
  const erAR = await run(`apply/${arBundle.file}`);
  check("release-av: Release AR is applied first" + (erAR ? ": " + erAR : ""), !erAR);
  const eav0 = await run(`apply/undo-step${st90.n}-${st90.slug}.sql`);
  check("release-av: before the bundle runs the first version of the rule is in place" + (eav0 ? ": " + eav0 : ""), !eav0 && !(await has()));
  const errAV = await run(`apply/${bundle.file}`);
  check("release-av bundle applies on top of Release AR" + (errAV ? ": " + errAV : ""), !errAV && (await has()));
  const againAV = await run(`apply/${bundle.file}`);
  check("release-av: a second run is refused, naming step 90 (" + againAV + ")", !!againAV && againAV.includes("step 90 (0344) cannot run") && againAV.includes("already applied"));
  const euAV = await run(`apply/undo-step${st90.n}-${st90.slug}.sql`);
  check("release-av: the undo puts the first version back" + (euAV ? ": " + euAV : ""), !euAV && !(await has()));
  const errAV2 = await run(`apply/${bundle.file}`);
  check("release-av: the bundle applies again after an undo" + (errAV2 ? ": " + errAV2 : ""), !errAV2 && (await has()));
  const euAR3 = await run(`apply/undo-step${st86.n}-${st86.slug}.sql`);
  check("release-av: Release AR is taken off again at the end" + (euAR3 ? ": " + euAR3 : ""), !euAR3);
}
// Release AW (step 91): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-aw");
  check("release-aw: ONE bundle holds step 91", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["91"]));
  const st91 = steps.find((x) => x.n === "91");
  const has = async () => (await db.query("select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_visible') as ok")).rows[0].ok === true;
  const eaw0 = await run(`apply/undo-step${st91.n}-${st91.slug}.sql`);
  check("release-aw: before the bundle runs the open profiles rule is back" + (eaw0 ? ": " + eaw0 : ""), !eaw0 && !(await has()));
  const errAW = await run(`apply/${bundle.file}`);
  check("release-aw bundle applies on the live-shaped state" + (errAW ? ": " + errAW : ""), !errAW && (await has()));
  const againAW = await run(`apply/${bundle.file}`);
  check("release-aw: a second run is refused, naming step 91 (" + againAW + ")", !!againAW && againAW.includes("step 91 (0345) cannot run") && againAW.includes("already applied"));
  const euAW = await run(`apply/undo-step${st91.n}-${st91.slug}.sql`);
  check("release-aw: the undo puts the old rules back" + (euAW ? ": " + euAW : ""), !euAW && !(await has()));
  const errAW2 = await run(`apply/${bundle.file}`);
  check("release-aw: the bundle applies again after an undo" + (errAW2 ? ": " + errAW2 : ""), !errAW2 && (await has()));
}
// Release AX (step 92): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ax");
  check("release-ax: ONE bundle holds step 92", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["92"]));
  const st92 = steps.find((x) => x.n === "92");
  const has = async () => (await db.query("select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_phase_plans' and policyname = 'client_phase_plans_coach_manage' and position('''athlete''::member_role' in with_check) = 0) as ok")).rows[0].ok === true;
  const eax0 = await run(`apply/undo-step${st92.n}-${st92.slug}.sql`);
  check("release-ax: before the bundle runs the athlete-only rules are back" + (eax0 ? ": " + eax0 : ""), !eax0 && !(await has()));
  const errAX = await run(`apply/${bundle.file}`);
  check("release-ax bundle applies on the live-shaped state" + (errAX ? ": " + errAX : ""), !errAX && (await has()));
  const againAX = await run(`apply/${bundle.file}`);
  check("release-ax: a second run is refused, naming step 92 (" + againAX + ")", !!againAX && againAX.includes("step 92 (0346) cannot run") && againAX.includes("already applied"));
  const euAX = await run(`apply/undo-step${st92.n}-${st92.slug}.sql`);
  check("release-ax: the undo puts the old rules back" + (euAX ? ": " + euAX : ""), !euAX && !(await has()));
  const errAX2 = await run(`apply/${bundle.file}`);
  check("release-ax: the bundle applies again after an undo" + (errAX2 ? ": " + errAX2 : ""), !errAX2 && (await has()));
}
// Release AY (step 93): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-ay");
  check("release-ay: ONE bundle holds step 93", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["93"]));
  const st93 = steps.find((x) => x.n === "93");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_briefings' and column_name = 'organization_id') as ok")).rows[0].ok === true;
  const eay0 = await run(`apply/undo-step${st93.n}-${st93.slug}.sql`);
  check("release-ay: before the bundle runs the old one-per-day rule is back" + (eay0 ? ": " + eay0 : ""), !eay0 && !(await has()));
  const errAY = await run(`apply/${bundle.file}`);
  check("release-ay bundle applies on the live-shaped state" + (errAY ? ": " + errAY : ""), !errAY && (await has()));
  const againAY = await run(`apply/${bundle.file}`);
  check("release-ay: a second run is refused, naming step 93 (" + againAY + ")", !!againAY && againAY.includes("step 93 (0347) cannot run") && againAY.includes("already applied"));
  const euAY = await run(`apply/undo-step${st93.n}-${st93.slug}.sql`);
  check("release-ay: the undo puts the old rule back" + (euAY ? ": " + euAY : ""), !euAY && !(await has()));
  const errAY2 = await run(`apply/${bundle.file}`);
  check("release-ay: the bundle applies again after an undo" + (errAY2 ? ": " + errAY2 : ""), !errAY2 && (await has()));
}
// Release AZ (step 94) and Release BA (step 95): one paste each.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const az = bundles.find((b) => b.id === "release-az");
  const ba = bundles.find((b) => b.id === "release-ba");
  check("release-az / release-ba: one bundle each (steps 94 and 95)", !!az && !!ba && JSON.stringify(az.steps) === JSON.stringify(["94"]) && JSON.stringify(ba.steps) === JSON.stringify(["95"]));
  const st94 = steps.find((x) => x.n === "94");
  const st95 = steps.find((x) => x.n === "95");
  const installed = async () => (await db.query("select to_regprocedure('public.request_workspace_org()') is not null as ok")).rows[0].ok === true;
  const on = async () => (await db.query("select position('select true' in pg_get_functiondef(to_regprocedure('public.org_wall_header_enabled()'))) > 0 as ok")).rows[0].ok === true;
  const e0 = await run(`apply/undo-step${st94.n}-${st94.slug}.sql`);
  check("release-az: before the bundle runs the rule is not installed" + (e0 ? ": " + e0 : ""), !e0 && !(await installed()));
  const errAZ = await run(`apply/${az.file}`);
  check("release-az bundle applies" + (errAZ ? ": " + errAZ : ""), !errAZ && (await installed()) && !(await on()));
  const againAZ = await run(`apply/${az.file}`);
  check("release-az: a second run is refused, naming step 94", !!againAZ && againAZ.includes("step 94 (0348) cannot run") && againAZ.includes("already applied"));
  const errBA = await run(`apply/${ba.file}`);
  check("release-ba bundle switches the rule on" + (errBA ? ": " + errBA : ""), !errBA && (await on()));
  const againBA = await run(`apply/${ba.file}`);
  check("release-ba: a second run is refused, naming step 95", !!againBA && againBA.includes("step 95 (0349) cannot run") && againBA.includes("already applied"));
  const euBA = await run(`apply/undo-step${st95.n}-${st95.slug}.sql`);
  check("release-ba: the undo switches it off again" + (euBA ? ": " + euBA : ""), !euBA && !(await on()) && (await installed()));
  const euAZ = await run(`apply/undo-step${st94.n}-${st94.slug}.sql`);
  check("release-az: the undo removes the rule everywhere" + (euAZ ? ": " + euAZ : ""), !euAZ && !(await installed()));
  const errAZ2 = await run(`apply/${az.file}`);
  check("release-az: the bundle applies again after an undo" + (errAZ2 ? ": " + errAZ2 : ""), !errAZ2 && (await installed()));
  await run(`apply/undo-step${st94.n}-${st94.slug}.sql`);
}
// Release BB (step 96): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-bb");
  check("release-bb: ONE bundle holds step 96", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["96"]));
  const st96 = steps.find((x) => x.n === "96");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pro_shop_links' and column_name = 'organization_id') as ok")).rows[0].ok === true;
  const ebb0 = await run(`apply/undo-step${st96.n}-${st96.slug}.sql`);
  check("release-bb: before the bundle runs the shop links have no organization" + (ebb0 ? ": " + ebb0 : ""), !ebb0 && !(await has()));
  const errBB = await run(`apply/${bundle.file}`);
  check("release-bb bundle applies on the live-shaped state" + (errBB ? ": " + errBB : ""), !errBB && (await has()));
  const againBB = await run(`apply/${bundle.file}`);
  check("release-bb: a second run is refused, naming step 96", !!againBB && againBB.includes("step 96 (0350) cannot run") && againBB.includes("already applied"));
  const euBB = await run(`apply/undo-step${st96.n}-${st96.slug}.sql`);
  check("release-bb: the undo puts the old rules back" + (euBB ? ": " + euBB : ""), !euBB && !(await has()));
  const errBB2 = await run(`apply/${bundle.file}`);
  check("release-bb: the bundle applies again after an undo" + (errBB2 ? ": " + errBB2 : ""), !errBB2 && (await has()));
}
// Release BC (step 97): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-bc");
  check("release-bc: ONE bundle holds step 97", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["97"]));
  const st97 = steps.find((x) => x.n === "97");
  const has = async () => (await db.query("select position('p_athlete_id is null then false' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) > 0 as ok")).rows[0].ok === true;
  const ebc0 = await run(`apply/undo-step${st97.n}-${st97.slug}.sql`);
  check("release-bc: before the bundle runs Duplicate comes out active" + (ebc0 ? ": " + ebc0 : ""), !ebc0 && !(await has()));
  const errBC = await run(`apply/${bundle.file}`);
  check("release-bc bundle applies" + (errBC ? ": " + errBC : ""), !errBC && (await has()));
  const againBC = await run(`apply/${bundle.file}`);
  check("release-bc: a second run is refused, naming step 97", !!againBC && againBC.includes("step 97 (0351) cannot run") && againBC.includes("already applied"));
  const euBC = await run(`apply/undo-step${st97.n}-${st97.slug}.sql`);
  check("release-bc: the undo puts the old Duplicate back" + (euBC ? ": " + euBC : ""), !euBC && !(await has()));
  const errBC2 = await run(`apply/${bundle.file}`);
  check("release-bc: the bundle applies again after an undo" + (errBC2 ? ": " + errBC2 : ""), !errBC2 && (await has()));
}
// Release BD (step 98): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-bd");
  check("release-bd: ONE bundle holds step 98", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["98"]));
  const st98 = steps.find((x) => x.n === "98");
  const has = async () => (await db.query("select to_regclass('public.organization_invites') is not null as ok")).rows[0].ok === true;
  const ebd0 = await run(`apply/undo-step${st98.n}-${st98.slug}.sql`);
  check("release-bd: before the bundle runs there are no invitations" + (ebd0 ? ": " + ebd0 : ""), !ebd0 && !(await has()));
  const errBD = await run(`apply/${bundle.file}`);
  check("release-bd bundle applies" + (errBD ? ": " + errBD : ""), !errBD && (await has()));
  const againBD = await run(`apply/${bundle.file}`);
  check("release-bd: a second run is refused, naming step 98", !!againBD && againBD.includes("step 98 (0352) cannot run") && againBD.includes("already applied"));
  const euBD = await run(`apply/undo-step${st98.n}-${st98.slug}.sql`);
  check("release-bd: the undo puts the owner's insert back" + (euBD ? ": " + euBD : ""), !euBD && !(await has()));
  const errBD2 = await run(`apply/${bundle.file}`);
  check("release-bd: the bundle applies again after an undo" + (errBD2 ? ": " + errBD2 : ""), !errBD2 && (await has()));
}
// Release BE (step 99): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-be");
  check("release-be: ONE bundle holds step 99", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["99"]));
  const st99 = steps.find((x) => x.n === "99");
  const has = async () => (await db.query("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'schedule_change_notice_days') as ok")).rows[0].ok === true;
  const ebe0 = await run(`apply/undo-step${st99.n}-${st99.slug}.sql`);
  check("release-be: before the bundle runs there is no notice setting" + (ebe0 ? ": " + ebe0 : ""), !ebe0 && !(await has()));
  const errBE = await run(`apply/${bundle.file}`);
  check("release-be bundle applies" + (errBE ? ": " + errBE : ""), !errBE && (await has()));
  const againBE = await run(`apply/${bundle.file}`);
  check("release-be: a second run is refused, naming step 99", !!againBE && againBE.includes("step 99 (0353) cannot run") && againBE.includes("already applied"));
  const euBE = await run(`apply/undo-step${st99.n}-${st99.slug}.sql`);
  check("release-be: the undo puts the old function back" + (euBE ? ": " + euBE : ""), !euBE && !(await has()));
  const errBE2 = await run(`apply/${bundle.file}`);
  check("release-be: the bundle applies again after an undo" + (errBE2 ? ": " + errBE2 : ""), !errBE2 && (await has()));
}
// Release BF (step 100): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-bf");
  check("release-bf: ONE bundle holds step 100", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["100"]));
  const st100 = steps.find((x) => x.n === "100");
  const has = async () => (await db.query("select to_regprocedure('public.guard_organization_share_total()') is not null as ok")).rows[0].ok === true;
  const ebf0 = await run(`apply/undo-step${st100.n}-${st100.slug}.sql`);
  check("release-bf: before the bundle runs there is no share-total rule" + (ebf0 ? ": " + ebf0 : ""), !ebf0 && !(await has()));
  const errBF = await run(`apply/${bundle.file}`);
  check("release-bf bundle applies" + (errBF ? ": " + errBF : ""), !errBF && (await has()));
  const againBF = await run(`apply/${bundle.file}`);
  check("release-bf: a second run is refused, naming step 100", !!againBF && againBF.includes("step 100 (0354) cannot run") && againBF.includes("already applied"));
  const euBF = await run(`apply/undo-step${st100.n}-${st100.slug}.sql`);
  check("release-bf: the undo puts the old rights back" + (euBF ? ": " + euBF : ""), !euBF && !(await has()));
  const errBF2 = await run(`apply/${bundle.file}`);
  check("release-bf: the bundle applies again after an undo" + (errBF2 ? ": " + errBF2 : ""), !errBF2 && (await has()));
}
// Release BJ (step 104): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-bj");
  check("release-bj: ONE bundle holds step 104", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["104"]));
  const st104 = steps.find((x) => x.n === "104");
  // Release BJ needs the organization wall (Release AZ) installed first; it is taken off again at the end of this block.
  const azb = bundles.find((b) => b.id === "release-az");
  const st94b = steps.find((x) => x.n === "94");
  const errAZb = await run(`apply/${azb.file}`);
  check("release-bj: the wall (Release AZ) is installed first" + (errAZb ? ": " + errAZb : ""), !errAZb);
  const has = async () => (await db.query("select to_regprocedure('public.ensure_personal_space()') is not null as ok")).rows[0].ok === true;
  const ebj0 = await run(`apply/undo-step${st104.n}-${st104.slug}.sql`);
  check("release-bj: before the bundle runs there is no personal-space function" + (ebj0 ? ": " + ebj0 : ""), !ebj0 && !(await has()));
  const errBJ = await run(`apply/${bundle.file}`);
  check("release-bj bundle applies" + (errBJ ? ": " + errBJ : ""), !errBJ && (await has()));
  const againBJ = await run(`apply/${bundle.file}`);
  check("release-bj: a second run is refused, naming step 104", !!againBJ && againBJ.includes("step 104 (0358) cannot run") && againBJ.includes("already applied"));
  const euBJ = await run(`apply/undo-step${st104.n}-${st104.slug}.sql`);
  check("release-bj: the undo removes the function" + (euBJ ? ": " + euBJ : ""), !euBJ && !(await has()));
  const errBJ2 = await run(`apply/${bundle.file}`);
  check("release-bj: the bundle applies again after an undo" + (errBJ2 ? ": " + errBJ2 : ""), !errBJ2 && (await has()));
  // Release BK (step 105) and Release BL (step 106): one paste each. At this point both are applied; take them back with their undos, then each bundle applies, a second run is refused, the undo returns it, and it applies again.
  {
    const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
    const bk = bundles.find((b) => b.id === "release-bk");
    const bl = bundles.find((b) => b.id === "release-bl");
    check("release-bk / release-bl: one bundle each (steps 105 and 106)", !!bk && !!bl && JSON.stringify(bk.steps) === JSON.stringify(["105"]) && JSON.stringify(bl.steps) === JSON.stringify(["106"]));
    const st105 = steps.find((x) => x.n === "105");
    const st106 = steps.find((x) => x.n === "106");
    const PS = "b0000000-0000-4000-8000-0000000000f1";
    const ESC = "b0000000-0000-4000-8000-0000000000e1";
    const inSpace = async () => Number((await db.query(`select count(*)::int as n from public.programs where id = 'b0000000-0000-4000-8000-0000000000a1' and group_id = '${PS}'`)).rows[0].n) === 1;
    const inEsc = async () => Number((await db.query(`select count(*)::int as n from public.programs where id = 'b0000000-0000-4000-8000-0000000000a1' and group_id = '${ESC}'`)).rows[0].n) === 1;
    const euBK = await run(`apply/undo-step${st105.n}-${st105.slug}.sql`);
    check("release-bk: the undo puts the program, workouts, session, log and check-in back in the Collective and drops the log" + (euBK ? ": " + euBK : ""), !euBK && (await inEsc()) && (await db.query("select to_regclass('public.personal_space_move_log') is null as ok")).rows[0].ok === true
      && Number((await db.query(`select count(*)::int as n from public.wellness_checkins where group_id = '${ESC}'`)).rows[0].n) === 1 && Number((await db.query(`select count(*)::int as n from public.group_workout_exercises where group_id = '${ESC}' and id = 'b0000000-0000-4000-8000-0000000000c1'`)).rows[0].n) === 1);
    const errBK = await run(`apply/${bk.file}`);
    check("release-bk bundle applies" + (errBK ? ": " + errBK : ""), !errBK && (await inSpace()));
    const againBK = await run(`apply/${bk.file}`);
    check("release-bk: a second run is refused, naming step 105", !!againBK && againBK.includes("step 105 (move-ron-personal-training) cannot run") && againBK.includes("already applied"));
    const euBK2 = await run(`apply/undo-step${st105.n}-${st105.slug}.sql`);
    check("release-bk: the undo returns it" + (euBK2 ? ": " + euBK2 : ""), !euBK2 && (await inEsc()));
    // Refused while the personal space does not exist.
    await db.exec(`alter table public.group_memberships disable trigger group_memberships_guard_personal_space`);
    await db.exec(`update public.groups set created_by = '00000000-0000-4000-8000-0000000000a1' where id = '${PS}'`);
    const noSpace = await run(`apply/${bk.file}`);
    check("release-bk: refused with nothing changed while Coach Ron has no personal space", !!noSpace && noSpace.includes("cannot run") && (await inEsc()));
    await db.exec(`update public.groups set created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' where id = '${PS}'`);
    await db.exec(`alter table public.group_memberships enable trigger group_memberships_guard_personal_space`);
    const errBK3 = await run(`apply/${bk.file}`);
    check("release-bk: the bundle applies again after an undo" + (errBK3 ? ": " + errBK3 : ""), !errBK3 && (await inSpace()));

    const lib = async () => Number((await db.query("select count(*)::int as n from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name in ('Sissy Squat', 'Thoracic Extension (Quadruped)', 'Handcuff W Rotation', 'Incline Iso Lateral Chest Press')")).rows[0].n);
    const aliases = async () => Number((await db.query("select count(*)::int as n from public.exercise_aliases where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and raw_name in ('Sissy Squats', 'Thoracic Extensions (Quadruped)')")).rows[0].n);
    check("release-bl: step 106 added the four exercises and the two spelling aliases", (await lib()) === 4 && (await aliases()) === 2);
    const euBL = await run(`apply/undo-step${st106.n}-${st106.slug}.sql`);
    check("release-bl: the undo removes them" + (euBL ? ": " + euBL : ""), !euBL && (await lib()) === 0 && (await aliases()) === 0);
    const errBL = await run(`apply/${bl.file}`);
    check("release-bl bundle applies" + (errBL ? ": " + errBL : ""), !errBL && (await lib()) === 4);
    const againBL = await run(`apply/${bl.file}`);
    check("release-bl: a second run is refused, naming step 106", !!againBL && againBL.includes("step 106 (add-fitpros-exercises) cannot run") && againBL.includes("already applied"));
  }
  await run(`apply/undo-step${st104.n}-${st104.slug}.sql`);
  await run(`apply/undo-step${st94b.n}-${st94b.slug}.sql`);
}
// Release BG (step 101): ONE paste.
{
  const bundles = JSON.parse(readFileSync(new URL("../../supabase/apply/bundles.json", import.meta.url), "utf8"));
  const bundle = bundles.find((b) => b.id === "release-bg");
  check("release-bg: ONE bundle holds step 101", !!bundle && JSON.stringify(bundle.steps) === JSON.stringify(["101"]));
  const st101 = steps.find((x) => x.n === "101");
  const has = async () => (await db.query("select to_regclass('public.client_assessments') is not null as ok")).rows[0].ok === true;
  const ebg0 = await run(`apply/undo-step${st101.n}-${st101.slug}.sql`);
  check("release-bg: before the bundle runs there is no assessments table" + (ebg0 ? ": " + ebg0 : ""), !ebg0 && !(await has()));
  const errBG = await run(`apply/${bundle.file}`);
  check("release-bg bundle applies" + (errBG ? ": " + errBG : ""), !errBG && (await has()));
  const againBG = await run(`apply/${bundle.file}`);
  check("release-bg: a second run is refused, naming step 101", !!againBG && againBG.includes("step 101 (0355) cannot run") && againBG.includes("already applied"));
  const euBG = await run(`apply/undo-step${st101.n}-${st101.slug}.sql`);
  check("release-bg: the undo removes the table" + (euBG ? ": " + euBG : ""), !euBG && !(await has()));
  const errBG2 = await run(`apply/${bundle.file}`);
  check("release-bg: the bundle applies again after an undo" + (errBG2 ? ": " + errBG2 : ""), !errBG2 && (await has()));
}
// The permanent function-permission check: all true after step 24, and it catches a new function that nobody closed.
{
  // The bundle tests above took steps back and applied them again, which recreated some trigger functions with the default (open) rights; closing them again is what steps 52 and 53 do.
  await db.exec(read("migrations/0307_close_target_change_notice_function.sql"));
  await db.exec(read("migrations/0308_close_trigger_functions.sql"));
  const rows = (await db.query(read("apply/check-function-acl.sql"))).rows;
  check("check-function-acl.sql after step 24: " + rows.length + " rows, all true" + (rows.some((r) => !r.ok) ? " (FALSE: " + rows.filter((r) => !r.ok).map((r) => r.check_name).join("; ") + ")" : ""), rows.length === 5 && rows.every((r) => r.ok));
  await db.exec("create function public.zz_new_internal(p_id uuid) returns void language plpgsql security definer set search_path = public as $f$ begin delete from public.profiles where id = p_id; end $f$; grant execute on function public.zz_new_internal(uuid) to authenticated");
  const caught = (await db.query(read("apply/check-function-acl.sql"))).rows;
  check("check-function-acl.sql catches a new SECURITY DEFINER function with no caller check that signed-in users can run", caught.some((r) => !r.ok && /zz_new_internal/.test(r.check_name)));
  await db.exec("drop function public.zz_new_internal(uuid)");
  await db.exec("grant execute on function public.apply_session_credit_change(uuid, uuid, integer, text, text, uuid, uuid) to authenticated");
  const reopened = (await db.query(read("apply/check-function-acl.sql"))).rows;
  check("check-function-acl.sql catches a server-only function that is opened to signed-in users again", reopened.some((r) => !r.ok && /server-only/.test(r.check_name)));
  await db.exec("revoke all on function public.apply_session_credit_change(uuid, uuid, integer, text, text, uuid, uuid) from authenticated");
}
// Running an already-applied step again is refused by its own guard (nothing changes), including 0248, which would otherwise undo 0236.
for (const f2 of ["apply/apply-step01-0249-0250-0254-0240-0241.sql", "apply/apply-step04-0263.sql", "apply/apply-step05-0236.sql", "apply/apply-step06-0251.sql", "apply-0248.sql"]) {
  const err = await run(f2);
  check(`re-running ${f2.split("/").pop()} is refused by its guard (${err})`, !!err && /already applied|no longer the version|not in the state/.test(err));
}
// The undo for step 09 restores the loose self-join (a signed-in person can add themselves with a valid invite).
{
  const e2 = await run("apply/undo-step09-0238.sql");
  check("undo-step09-0238.sql runs" + (e2 ? ": " + e2 : ""), !e2);
  await db.exec(read("apply/apply-step09-0238.sql"));
}
// Re-running a precheck after its step must flag it as already applied (so nobody applies a step twice by mistake) for the steps that say so.
for (const n of ["02", "04", "05", "06", "08"]) {
  const s = steps.find((x) => x.n === n);
  const rows = await pre(`apply/apply-step${s.n}-${s.slug}-precheck.sql`);
  check(`step ${n} precheck run again after applying has a false row ("already applied")`, rows.some((r) => !r.ok));
}
// 0267's logging survives being re-applied after 0266 is re-run.
e = await run("apply-now-0264-0265-0266-0253.sql");
e = e || (await run("apply-0267.sql"));
check("0267 can be re-applied after the 0266 file is re-run" + (e ? `: ${e}` : ""), !e);
process.exit(failures ? 1 : 0);
