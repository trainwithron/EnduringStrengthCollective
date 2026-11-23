// Rehearses step 225 (migration 0469): "eggs" finds the everyday boiled egg first, not a lab egg yolk (live check of step 223, Nov 23). On a stand-in shaped like live (step 223
// applied, the hand-made FNDDS sample loaded through the real importer, and the live Foundation / SR Legacy egg rows), the search before and after the paste, Ron's examples unchanged,
// the undo back to exactly step 223's search (the live md5), and the paste again. The same check was run on all 5,432 real FNDDS foods.
//   node scripts/sql-tests/food-search-eggs.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LF = String.fromCharCode(10);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, LF);
const db = new PGlite();
const failures = [];
const expect = (name, cond, extra = "") => {
  if (!cond) failures.push(name + (extra ? ` (${extra})` : ""));
};

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.usda_foods (fdc_id integer primary key, description text not null, data_type text not null check (data_type in ('Foundation', 'SR Legacy')), food_category text, created_at timestamptz not null default now());
  create table public.usda_food_nutrients (id uuid primary key default gen_random_uuid(), fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade, nutrient_key text not null, amount_per_100g numeric not null, unique (fdc_id, nutrient_key));
  create table public.usda_food_portions (id bigint generated always as identity primary key, fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade, seq integer not null, description text not null, gram_weight numeric not null, unique (fdc_id, seq));
  create table public.usda_load_batches (name text primary key, rows_loaded integer not null, loaded_at timestamptz not null default now());
  grant select on public.usda_foods, public.usda_food_nutrients, public.usda_food_portions to authenticated;
`);
// the live Foundation / SR Legacy rows that start with "egg" (read Nov 23)
const live = [
  [747997, "Eggs, Grade A, Large, egg white", "Foundation"], [748236, "Eggs, Grade A, Large, egg yolk", "Foundation"], [748967, "Eggs, Grade A, Large, egg whole", "Foundation"],
  [323604, "Egg, whole, raw, frozen, pasteurized", "Foundation"], [169904, "Eggs, scrambled, frozen mixture", "SR Legacy"], [171287, "Egg, whole, raw, fresh", "SR Legacy"],
  [172186, "Egg, whole, cooked, poached", "SR Legacy"], [171258, "Eggnog", "SR Legacy"], [169228, "Eggplant, raw", "SR Legacy"],
  [171265, "Milk, whole, 3.25% milkfat, with added vitamin D", "SR Legacy"], [174832, "Bread, french or vienna (includes sourdough)", "SR Legacy"],
];
for (const [id, d, t] of live) {
  await db.query(`insert into public.usda_foods (fdc_id, description, data_type) values ($1, $2, $3)`, [id, d, t]);
  await db.query(`insert into public.usda_food_nutrients (fdc_id, nutrient_key, amount_per_100g) values ($1, 'kcal', 100)`, [id]);
}
const lastRow = (results) => results[results.length - 1].rows;
const oneRowAllTrue = (rows) => rows.length === 1 && Object.values(rows[0]).length > 0 && Object.values(rows[0]).every((v) => v === true);
let r = lastRow(await db.exec(read("../../supabase/apply/apply-step223-0467.sql")));
expect("step 223 applies (as live)", oneRowAllTrue(r), JSON.stringify(r[0]));
const out = mkdtempSync(join(tmpdir(), "fndds-eggs-"));
execFileSync(process.execPath, [fileURLToPath(new URL("../usda-import.mjs", import.meta.url)), fileURLToPath(new URL("./fixtures/fndds-sample/", import.meta.url)), "--name", "fndds-eggs", "--out", out, "--batch-size", "50"], { stdio: "pipe" });
for (const f of readdirSync(out).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(join(out, f), "utf8"));
rmSync(out, { recursive: true, force: true });
const md5 = async () => (await db.query(`select md5(replace(prosrc, chr(13), '')) m from pg_proc where oid = 'public.search_usda_foods(text[], integer)'::regprocedure`)).rows[0].m;
const LIVE_223 = "59fe9a87f5434ae068163b5f130b61d5";
expect("the step 223 search here is the live one", (await md5()) === LIVE_223, await md5());

const tokenize = (q) => [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 || /\d/.test(w)))].slice(0, 6);
const first = async (q) => {
  await db.exec(`set role authenticated`);
  try {
    return (await db.query(`select fdc_id, description from public.search_usda_foods($1::text[], 25)`, [tokenize(q)])).rows[0]?.fdc_id;
  } finally {
    await db.exec(`reset role`);
  }
};
const RON = { "whole milk": 2705385, "2% milk": 2705386, "sourdough bread": 2707646, "french bread": 2707647, "salmon": 2709200, "banana": 2709100 };
expect("before: the miss seen live ('eggs' gives a Foundation egg row)", (await first("eggs")) !== 2707150);

const migration = read("../../supabase/migrations/0469_food_search_eggs.sql");
const apply = read("../../supabase/apply/apply-step225-0469.sql");
const undo = read("../../supabase/apply/undo-step225-0469.sql");
const ascii = (s) => [...s].every((c) => c.charCodeAt(0) < 128);
expect("paste holds the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo are plain ASCII", ascii(apply) && ascii(undo));
r = lastRow(await db.exec(apply));
expect("paste 225: one row, all true", oneRowAllTrue(r), JSON.stringify(r[0]));
await db.exec(migration);
expect("after: 'eggs' gives the boiled egg first", (await first("eggs")) === 2707150, String(await first("eggs")));
expect("after: 'egg' too", (await first("egg")) === 2707150);
for (const [q, id] of Object.entries(RON)) expect(`after: "${q}" unchanged`, (await first(q)) === id, String(await first(q)));

r = lastRow(await db.exec(undo));
expect("undo: one row, all true", oneRowAllTrue(r), JSON.stringify(r[0]));
expect("undo: the search is exactly step 223's again (the live md5)", (await md5()) === LIVE_223);
r = lastRow(await db.exec(apply));
expect("paste again after the undo: one row, all true", oneRowAllTrue(r));
expect("and 'eggs' is the boiled egg again", (await first("eggs")) === 2707150);

if (failures.length) {
  console.error("FAILED:" + LF + "- " + failures.join(LF + "- "));
  process.exit(1);
}
console.log("OK: step 225 rehearsal passed");
