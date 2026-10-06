// The paste-ready SQL files Ron runs by hand, applied in the order he runs them against the live-equivalent schema: every precheck must be all true
// before its apply file, the apply file must succeed, and a precheck run again afterwards must say the step is already applied.
//   node scripts/sql-tests/paste-files.test.mjs   (also part of npm run test:sql)
import { readFileSync } from "node:fs";
import { createDb, applyLiveEquivalent } from "./harness.mjs";
import { undoSql as functionAclOpenSql } from "../function-acl.mjs";

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
// The permanent function-permission check: all true after step 24, and it catches a new function that nobody closed.
{
  const rows = (await db.query(read("apply/check-function-acl.sql"))).rows;
  check("check-function-acl.sql after step 24: " + rows.length + " rows, all true" + (rows.some((r) => !r.ok) ? " (FALSE: " + rows.filter((r) => !r.ok).map((r) => r.check_name).join("; ") + ")" : ""), rows.length === 4 && rows.every((r) => r.ok));
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
