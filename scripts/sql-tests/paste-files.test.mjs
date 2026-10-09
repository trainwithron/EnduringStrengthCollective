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
  const base = `apply/apply-step${s.n}-${s.slug}`;
  const rows = await pre(`${base}-precheck.sql`);
  const bad = rows.filter((r) => !r.ok).map((r) => r.check_name);
  check(`step ${s.n} (${s.slug}) precheck: ${rows.length} rows, all true` + (bad.length ? ` (FALSE: ${bad.join("; ")})` : ""), rows.length === s.rows && bad.length === 0);
  e = await run(`${base}.sql`);
  check(`step ${s.n} (${s.slug}) applies` + (e ? `: ${e}` : ""), !e);
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
