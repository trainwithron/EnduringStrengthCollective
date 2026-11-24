// Rehearses step 228 (migration 0472, Ron Nov 24: the program Spotter checks the lifting days against the client's goal sheet). On a stand-in shaped like live (the dismissals
// table with the five checks of 0193): the new check's answer is refused before the paste, saved after it, the other checks still saved, the undo back to the five (its answers
// removed), and the paste again.
//   node scripts/sql-tests/program-spotter-days.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const LF = String.fromCharCode(10);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, LF);
const db = new PGlite();
const failures = [];
const expect = (name, cond, extra = "") => {
  if (!cond) failures.push(name + (extra ? ` (${extra})` : ""));
};
await db.exec(`
  create table public.programs (id uuid primary key default gen_random_uuid(), name text not null);
  create table public.programming_spotter_dismissals (
    id uuid primary key default gen_random_uuid(),
    program_id uuid not null references public.programs(id) on delete cascade,
    check_kind text not null,
    pattern_key text not null,
    dismissed_count int not null default 1,
    last_dismissed_at timestamptz not null default now(),
    unique (program_id, check_kind, pattern_key)
  );
  alter table public.programming_spotter_dismissals add constraint programming_spotter_dismissals_check_kind_check
    check (check_kind in ('volume_concentration', 'redundancy', 'flat_repeat', 'missing_pattern', 'biomech_redundancy'));
  insert into public.programs (id, name) values ('00000000-0000-4000-8000-000000000001', 'Robyn 3-day');
  insert into public.programming_spotter_dismissals (program_id, check_kind, pattern_key) values ('00000000-0000-4000-8000-000000000001', 'redundancy', 'p1');
`);
const P = "00000000-0000-4000-8000-000000000001";
const tryInsert = async (kind, key) => {
  try {
    await db.query(`insert into public.programming_spotter_dismissals (program_id, check_kind, pattern_key) values ($1, $2, $3)`, [P, kind, key]);
    return true;
  } catch {
    return false;
  }
};
const lastRow = (results) => results[results.length - 1].rows;
const allTrue = (rows) => rows.length === 1 && Object.values(rows[0]).length > 0 && Object.values(rows[0]).every((v) => v === true);

expect("before: the new check's answer is refused (live today)", !(await tryInsert("lifting_days", "sheet_3")));

const migration = read("../../supabase/migrations/0472_program_spotter_lifting_days.sql");
const apply = read("../../supabase/apply/apply-step228-0472.sql");
const undo = read("../../supabase/apply/undo-step228-0472.sql");
const ascii = (s) => [...s].every((c) => c.charCodeAt(0) < 128);
expect("paste holds the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo are plain ASCII", ascii(apply) && ascii(undo));

let r = lastRow(await db.exec(apply));
expect("paste 228: one row, all true", allTrue(r), JSON.stringify(r[0]));
expect("after: the new check's answer is saved", await tryInsert("lifting_days", "sheet_3"));
expect("after: the other checks are still saved", await tryInsert("biomech_redundancy", "t1"));
expect("after: an unknown check is still refused", !(await tryInsert("anything_else", "x")));
expect("the answers already there stay", (await db.query(`select count(*)::int n from public.programming_spotter_dismissals where check_kind = 'redundancy'`)).rows[0].n === 1);
await db.exec(migration);
expect("re-running the migration is safe", (await db.query(`select count(*)::int n from pg_constraint where conname = 'programming_spotter_dismissals_check_kind_check'`)).rows[0].n === 1);

r = lastRow(await db.exec(undo));
expect("undo: one row, all true", allTrue(r), JSON.stringify(r[0]));
expect("undo: the other answers stay", (await db.query(`select count(*)::int n from public.programming_spotter_dismissals`)).rows[0].n === 2);
expect("undo: the new check's answer is refused again", !(await tryInsert("lifting_days", "sheet_3")));
r = lastRow(await db.exec(apply));
expect("paste again: one row, all true", allTrue(r), JSON.stringify(r[0]));

if (failures.length) {
  console.error(`FAIL step 228 rehearsal: ${failures.length} failed`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("OK: step 228 rehearsal passed");
