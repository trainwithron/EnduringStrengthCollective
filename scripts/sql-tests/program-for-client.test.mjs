// Rehearses step 229 (migration 0473, Ron Nov 24: Build program reopens the client's draft instead of making a new program every tap). On a stand-in shaped like live (programs
// pointing at profiles): the paste adds for_client_id and its index, a draft can be tied to its client, removing the client keeps the draft (the link is cleared), the old drafts are
// untouched, re-running is safe, the undo takes it back, and the paste runs again.
//   node scripts/sql-tests/program-for-client.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const LF = String.fromCharCode(10);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, LF);
const db = new PGlite();
const failures = [];
const expect = (name, cond, extra = "") => {
  if (!cond) failures.push(name + (extra ? ` (${extra})` : ""));
};
const COACH = "00000000-0000-4000-8000-0000000000c1";
const ROBYN = "00000000-0000-4000-8000-0000000000a1";
const OLD = "00000000-0000-4000-8000-000000000001";
await db.exec(`
  create table public.profiles (id uuid primary key, full_name text);
  create table public.programs (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_by uuid references public.profiles(id),
    athlete_id uuid references public.profiles(id) on delete cascade,
    archived_at timestamptz
  );
  insert into public.profiles (id, full_name) values ('${COACH}', 'Ron Coach'), ('${ROBYN}', 'Robyn Client');
  insert into public.programs (id, name, created_by) values ('${OLD}', 'Robyn''s program', '${COACH}');
`);
const lastRow = (results) => results[results.length - 1].rows;
const allTrue = (rows) => rows.length === 1 && Object.values(rows[0]).length > 0 && Object.values(rows[0]).every((v) => v === true);
const count = async (sql) => (await db.query(sql)).rows[0].n;

const migration = read("../../supabase/migrations/0473_program_for_client.sql");
const apply = read("../../supabase/apply/apply-step229-0473.sql");
const undo = read("../../supabase/apply/undo-step229-0473.sql");
const ascii = (s) => [...s].every((c) => c.charCodeAt(0) < 128);
expect("paste holds the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo are plain ASCII", ascii(apply) && ascii(undo));

let r = lastRow(await db.exec(apply));
expect("paste 229: one row, all true", allTrue(r), JSON.stringify(r[0]));
expect("the old draft is untouched (no backfill)", (await count(`select count(*)::int n from public.programs where for_client_id is null`)) === 1);
await db.exec(`insert into public.programs (name, created_by, for_client_id) values ('Robyn''s program', '${COACH}', '${ROBYN}')`);
expect("a new draft is tied to its client", (await count(`select count(*)::int n from public.programs where for_client_id = '${ROBYN}'`)) === 1);
let refused = false;
try {
  await db.exec(`insert into public.programs (name, created_by, for_client_id) values ('x', '${COACH}', '00000000-0000-4000-8000-0000000000ff')`);
} catch {
  refused = true;
}
expect("a client that does not exist is refused", refused);
await db.exec(migration);
expect("re-running the migration is safe", (await count(`select count(*)::int n from pg_indexes where indexname = 'programs_for_client_draft_idx'`)) === 1);
await db.exec(`delete from public.profiles where id = '${ROBYN}'`);
expect("removing the client keeps the coach's draft, with the link cleared", (await count(`select count(*)::int n from public.programs`)) === 2 && (await count(`select count(*)::int n from public.programs where for_client_id is not null`)) === 0);

r = lastRow(await db.exec(undo));
expect("undo: one row, all true", allTrue(r), JSON.stringify(r[0]));
expect("undo: the drafts stay", (await count(`select count(*)::int n from public.programs`)) === 2);
r = lastRow(await db.exec(apply));
expect("paste again: one row, all true", allTrue(r), JSON.stringify(r[0]));

if (failures.length) {
  console.error(`FAIL step 229 rehearsal: ${failures.length} failed`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("OK: step 229 rehearsal passed");
