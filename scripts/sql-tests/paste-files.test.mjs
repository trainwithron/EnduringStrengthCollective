// The paste-ready SQL files Ron runs by hand, run against the live-equivalent schema: the combined policy file (twice, to prove it is
// re-runnable), and the 0248 precheck (all true before, and the 0248 file applies after it).
//   node scripts/sql-tests/paste-files.test.mjs
import { readFileSync } from "node:fs";
import { createDb, applyLiveEquivalent } from "./harness.mjs";
const read = (f) => readFileSync(new URL(`../../supabase/${f}`, import.meta.url), "utf8").replace(/create extension[^;]*;/gi, "");
const db = await createDb();
await applyLiveEquivalent(db);
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const pre = async () => (await db.query(read("apply-0248-precheck.sql"))).rows;
const before = await pre();
check("precheck: every row is true on the live-equivalent schema", before.length === 6 && before.every((r) => r.ok));
await db.exec(read("apply-0248.sql"));
check("apply-0248.sql applies", true);
const p36 = (await db.query(read("apply-0236-precheck.sql"))).rows;
check("0236 precheck: every row true after 0248", p36.length === 4 && p36.every((r) => r.ok));
await db.exec(read("apply-0236.sql"));
check("apply-0236.sql applies", true);
const after = await pre();
check("precheck after: refuses a second run (already applied is false, block gone)", after.some((r) => !r.ok));
for (let i = 1; i <= 2; i++) {
  try { await db.exec(read("apply-now-0264-0265-0266-0253.sql")); check(`apply-now-0264-0265-0266-0253.sql run ${i}`, true); } catch (e) { check(`apply-now run ${i}: ${e.message}`, false); }
}
const pre67 = async () => (await db.query(read("apply-0267-precheck.sql"))).rows;
const p67 = await pre67();
check("0267 precheck: every row is true once 0266 is applied", p67.length === 5 && p67.every((r) => r.ok));
for (let i = 1; i <= 2; i++) {
  try { await db.exec(read("apply-0267.sql")); check(`apply-0267.sql run ${i}`, true); } catch (e) { check(`apply-0267 run ${i}: ${e.message}`, false); }
}
// Re-running 0266 afterwards loses the logging; the header says to re-run 0267, which restores it.
await db.exec(read("apply-now-0264-0265-0266-0253.sql"));
await db.exec(read("apply-0267.sql"));
check("0267 can be re-applied after 0266 is re-run", true);
process.exit(failures ? 1 : 0);
