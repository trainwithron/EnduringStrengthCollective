// Rehearses step 224 (migration 0468): USDA Branded Foods. On an in-memory Postgres: the migration run twice (re-running is safe), the import batches written from the hand-made
// sample (scripts/sql-tests/fixtures/branded-sample) run twice, a later release replacing a product under a new fdc_id, the search as a signed-in person, who may read and write,
// and the paste and its undo.
//   node scripts/sql-tests/usda-branded.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { addBranded, addFoodRow, addNutrientRow, buildBrandedNutrientIndex, finalizeBranded, parseCsvRecords, toBrandedBatchSql } from "../usda-branded-lib.mjs";

const LF = String.fromCharCode(10);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(LF);
const db = new PGlite();
const failures = [];
const expect = (name, cond) => {
  if (!cond) failures.push(name);
};

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  -- as 0300 made it
  create table public.usda_load_batches (name text primary key, rows_loaded integer not null check (rows_loaded >= 0), loaded_at timestamptz not null default now());
`);

const migration = read("../../supabase/migrations/0468_usda_branded_foods.sql");
await db.exec(migration);
await db.exec(migration);

// The batch the importer writes from the sample.
const sample = (f) => parseCsvRecords(read(`./fixtures/branded-sample/${f}`));
const index = new Map();
for (const r of sample("branded_food.csv")) addBranded(index, r);
for (const r of sample("food.csv")) addFoodRow(index, r);
const nutrients = buildBrandedNutrientIndex(sample("nutrient.csv"));
for (const r of sample("food_nutrient.csv")) addNutrientRow(index, nutrients, r);
const { rows } = finalizeBranded(index);
const batch = toBrandedBatchSql("branded-sample-0001", rows);
await db.exec(batch);
await db.exec(batch);
const count = async () => (await db.query("select count(*)::int n from public.usda_branded_foods")).rows[0].n;
expect("the batch loads the 4 products", (await count()) === 4);
expect("running it again does nothing (one marker)", (await db.query("select count(*)::int n from public.usda_load_batches where name = 'branded-sample-0001'")).rows[0].n === 1);

// A later release: the milk under a new fdc_id (same barcode) and the bar's numbers changed.
const milk = rows.find((r) => r.fdc_id === 1000003);
const bar = rows.find((r) => r.fdc_id === 1000004);
await db.exec(toBrandedBatchSql("branded-2027-01-0001", [{ ...milk, fdc_id: 1000099, published_date: "2027-01-01" }, { ...bar, kcal: 320 }]));
const milkRows = (await db.query("select fdc_id from public.usda_branded_foods where gtin = '811620020121'")).rows;
expect("a product republished under a new fdc_id replaces the old row with the same barcode", milkRows.length === 1 && milkRows[0].fdc_id === 1000099);
expect("a product republished under its fdc_id is updated in place", (await db.query("select kcal from public.usda_branded_foods where fdc_id = 1000004")).rows[0].kcal === "320");
expect("still 4 products", (await count()) === 4);

// A half-bad batch loads nothing: one row breaks a check, so the whole statement and its marker are rolled back.
let broke = false;
try {
  await db.exec(toBrandedBatchSql("branded-bad-0001", [{ ...bar, fdc_id: 1000200, gtin: "99999" }, { ...bar, fdc_id: 1000201, gtin: "99998", kcal: 5000 }]));
} catch {
  broke = true;
}
expect("a batch with a bad row fails as a whole", broke && (await count()) === 4 && (await db.query("select count(*)::int n from public.usda_load_batches where name = 'branded-bad-0001'")).rows[0].n === 0);

// As a signed-in person, and as nobody.
const as = async (role, sql, params = []) => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true)");
    await db.exec(`set local role ${role}`);
    const r = await db.query(sql, params);
    await db.exec("commit");
    return { rows: r.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e };
  }
};
const search = (tokens, limit = 10) => as("authenticated", "select * from public.search_branded_foods($1::text[], $2)", [tokens, limit]);
const names = (r) => r.rows.map((x) => x.description);

expect("brand finds the product", names(await search(["cheerios"]))[0] === "CHEERIOS TOASTED WHOLE GRAIN OAT CEREAL");
expect("the brand owner's words find it too", names(await search(["general", "mills"]))[0] === "CHEERIOS TOASTED WHOLE GRAIN OAT CEREAL");
expect("every word must be there", names(await search(["cheerios", "milk"])).length === 0);
expect("the last word may be the start of a word", names(await search(["fairlife", "ultra", "filt"])).includes("REDUCED FAT 2% ULTRA-FILTERED MILK"));
expect("words like 2% are cleaned, not passed through", names(await search(["2%", "milk"])).includes("REDUCED FAT 2% ULTRA-FILTERED MILK"));
expect("text-search operators cannot reach the query", (await search(["milk:*|!", "&(bar)"])).error === null);
expect("nothing searchable is nothing", names(await search(["", "!!"])).length === 0);
const limited = await search(["a", "b", "c", "d", "e", "f", "g", "h"], 500);
expect("the limit is capped and long queries are cut, without an error", limited.error === null);
expect("a signed-in person can read the table", (await as("authenticated", "select count(*)::int n from public.usda_branded_foods")).rows[0]?.n === 4);
expect("a signed-in person cannot write it", (await as("authenticated", "insert into public.usda_branded_foods (fdc_id, description, kcal, protein_g) values (1, 'x', 1, 1)")).error !== null);
expect("nobody signed in cannot read it", (await as("anon", "select count(*) from public.usda_branded_foods")).error !== null);
expect("nobody signed in cannot search", (await as("anon", "select * from public.search_branded_foods(array['milk'], 5)")).error !== null);
expect("one row per barcode is enforced", (await db.query("select count(*)::int n from pg_indexes where indexname = 'usda_branded_foods_gtin_key' and indexdef like '%UNIQUE%'")).rows[0].n === 1);

// The paste and its undo.
const apply = read("../../supabase/apply/apply-step224-0468.sql");
const undo = read("../../supabase/apply/undo-step224-0468.sql");
const ascii = (s) => [...s].every((c) => c.charCodeAt(0) < 128);
expect("paste: holds the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo: plain ASCII", ascii(apply) && ascii(undo));
const lastRow = (results) => results[results.length - 1].rows[0];
const allTrue = (row) => !!row && Object.values(row).every((v) => v === true);
expect("paste: check row all true (over a database that already has it)", allTrue(lastRow(await db.exec(apply))));
expect("undo: check row all true", allTrue(lastRow(await db.exec(undo))));
expect("undo: the branded load markers are gone (only branded ones existed)", (await db.query("select count(*)::int n from public.usda_load_batches")).rows[0].n === 0);
await db.exec("insert into public.usda_load_batches (name, rows_loaded) values ('fdc-2026-04-001', 1)");
expect("paste: applies again after the undo", allTrue(lastRow(await db.exec(apply))));
await db.exec(batch);
expect("and the batch loads again after the undo (its marker was cleared)", (await count()) === 4);
await db.exec(undo);
expect("undo leaves a non-branded marker alone", (await db.query("select count(*)::int n from public.usda_load_batches where name = 'fdc-2026-04-001'")).rows[0].n === 1);

if (failures.length) {
  console.error("FAILED:" + LF + "- " + failures.join(LF + "- "));
  process.exit(1);
}
console.log("OK: step 224 rehearsal passed");
