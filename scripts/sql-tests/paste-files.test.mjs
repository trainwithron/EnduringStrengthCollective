// The paste-ready SQL files Ron runs by hand, applied in the order he runs them against the live-equivalent schema: every precheck must be all true
// before its apply file, the apply file must succeed, and a precheck run again afterwards must say the step is already applied.
//   node scripts/sql-tests/paste-files.test.mjs   (also part of npm run test:sql)
import { readFileSync } from "node:fs";
import { createDb, applyLiveEquivalent } from "./harness.mjs";

const read = (f) => readFileSync(new URL(`../../supabase/${f}`, import.meta.url), "utf8").replace(/create extension[^;]*;/gi, "");
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
  const base = `apply/apply-step${s.n}-${s.slug}`;
  const rows = await pre(`${base}-precheck.sql`);
  const bad = rows.filter((r) => !r.ok).map((r) => r.check_name);
  check(`step ${s.n} (${s.slug}) precheck: ${rows.length} rows, all true` + (bad.length ? ` (FALSE: ${bad.join("; ")})` : ""), rows.length === s.rows && bad.length === 0);
  e = await run(`${base}.sql`);
  check(`step ${s.n} (${s.slug}) applies` + (e ? `: ${e}` : ""), !e);
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
