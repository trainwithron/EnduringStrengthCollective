// Rehearses step 224 (migration 0468): USDA Branded Foods. On an in-memory Postgres: the migration run twice (re-running is safe), the import batches written from the hand-made
// sample (scripts/sql-tests/fixtures/branded-sample) run twice, a later release replacing a product under a new fdc_id, the search as a signed-in person, who may read and write,
// and the paste and its undo.
//   node scripts/sql-tests/usda-branded.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { addBranded, addFoodRow, addNutrientRow, buildBrandedNutrientIndex, finalizeBranded, parseCsvRecords, toBrandedBatchSql, toBrandedJsonBatch } from "../usda-branded-lib.mjs";

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
// The order (review of a4bd9194, timed on the full October 2026 release): only the last word is a prefix; whole words before a prefix match; the plain short name first; a "2" counts
// as a word of the name; a name that repeats the words does not jump ahead.
await db.exec(`insert into public.usda_branded_foods (fdc_id, gtin, brand_name, description, kcal, protein_g) values
  (9000001, '9000001', 'MILKITA', 'MILKITA, MILKSHAKE CANDY', 400, 1),
  (9000002, '9000002', 'DAIRY', 'WHOLE MILK', 61, 3.2),
  (9000003, '9000003', 'DAIRY', '2% MILK', 50, 3.3),
  (9000004, '9000004', 'GALBANI', 'RICOTTA CHEESE, WHOLE MILK, WHOLE MILK', 150, 7),
  (9000005, '9000005', 'DAIRY', 'MILK CHOCOLATE CANDY BAR WITH ALMONDS AND A LONG NAME', 500, 7)`);
expect("a whole-word match comes before a prefix match", names(await search(["milk"])).indexOf("WHOLE MILK") < names(await search(["milk"])).indexOf("MILKITA, MILKSHAKE CANDY"));
expect("only the last word is a prefix: 'milks' as a first word needs the whole word", names(await search(["milks", "candy"])).length === 0);
expect("the 2 of '2% milk' picks the 2% milk first", names(await search(["2%", "milk"]))[0] === "2% MILK");
expect("the plain name beats one that repeats the words", names(await search(["whole", "milk"]))[0] === "WHOLE MILK");
expect("a lone short word is not searched on its own", names(await search(["2"])).length === 0);
await db.exec("delete from public.usda_branded_foods where fdc_id between 9000001 and 9000005");
const limited = await search(["a", "b", "c", "d", "e", "f", "g", "h"], 500);
expect("the limit is capped and long queries are cut, without an error", limited.error === null);
expect("a signed-in person can read the table", (await as("authenticated", "select count(*)::int n from public.usda_branded_foods")).rows[0]?.n === 4);
expect("a signed-in person cannot write it", (await as("authenticated", "insert into public.usda_branded_foods (fdc_id, description, kcal, protein_g) values (1, 'x', 1, 1)")).error !== null);
expect("nobody signed in cannot read it", (await as("anon", "select count(*) from public.usda_branded_foods")).error !== null);
expect("nobody signed in cannot search", (await as("anon", "select * from public.search_branded_foods(array['milk'], 5)")).error !== null);
expect("one row per barcode is enforced", (await db.query("select count(*)::int n from pg_indexes where indexname = 'usda_branded_foods_gtin_key' and indexdef like '%UNIQUE%'")).rows[0].n === 1);

// Loading through load_usda_branded_batch (one call per batch, the server key; scripts/usda-branded-load.mjs), with the JSON body the importer writes (--json).
const callLoad = (role, body) => as(role, "select public.load_usda_branded_batch($1, $2::jsonb) as n", [JSON.parse(body).p_name, JSON.stringify(JSON.parse(body).p_rows)]);
await db.exec("delete from public.usda_branded_foods; delete from public.usda_load_batches;");
const jsonBody = toBrandedJsonBatch("branded-json-0001", rows);
const first = await callLoad("service_role", jsonBody);
expect("the server key loads a JSON batch: its rows, in one call", first.error === null && first.rows[0]?.n === 4 && (await count()) === 4);
const again = await callLoad("service_role", jsonBody);
expect("the same batch again does nothing and says 0", again.error === null && again.rows[0]?.n === 0 && (await db.query("select count(*)::int n from public.usda_load_batches where name = 'branded-json-0001'")).rows[0].n === 1);
const newer = await callLoad("service_role", toBrandedJsonBatch("branded-json-0002", [{ ...milk, fdc_id: 1000099, published_date: "2027-01-01" }, { ...bar, kcal: 320 }]));
const milkNow = (await db.query("select fdc_id from public.usda_branded_foods where gtin = '811620020121'")).rows;
expect("through the function too: a new fdc_id for the same barcode replaces the old row", newer.error === null && milkNow.length === 1 && milkNow[0].fdc_id === 1000099);
expect("and the same fdc_id is updated in place", (await db.query("select kcal from public.usda_branded_foods where fdc_id = 1000004")).rows[0].kcal === "320" && (await count()) === 4);
const badCall = await callLoad("service_role", toBrandedJsonBatch("branded-json-0003", [{ ...bar, fdc_id: 1000300, gtin: "77777" }, { ...bar, fdc_id: 1000301, gtin: "77776", kcal: 5000 }]));
expect("a bad row fails the whole call: no rows, no marker", badCall.error !== null && (await count()) === 4 && (await db.query("select count(*)::int n from public.usda_load_batches where name = 'branded-json-0003'")).rows[0].n === 0);
const wrongType = await callLoad("service_role", toBrandedJsonBatch("branded-json-0004", [{ ...bar, fdc_id: 1000400, kcal: "lots" }]));
expect("a value of the wrong type fails the whole call", wrongType.error !== null && (await db.query("select count(*)::int n from public.usda_load_batches where name = 'branded-json-0004'")).rows[0].n === 0);
expect("anyone signed in cannot call it", (await callLoad("authenticated", toBrandedJsonBatch("branded-json-0005", [bar]))).error !== null);
expect("nobody signed in cannot call it", (await callLoad("anon", toBrandedJsonBatch("branded-json-0006", [bar]))).error !== null);
const shape = (name, rowsJson) => as("service_role", "select public.load_usda_branded_batch($1, $2::jsonb) as n", [name, rowsJson]);
expect("rows that are not an array are refused", /must be a JSON array/.test(String((await shape("branded-json-0007", '{"fdc_id": 1}')).error?.message)));
expect("an array of things that are not products is refused", /JSON object/.test(String((await shape("branded-json-0008", "[1, 2]")).error?.message)));
expect("an empty batch is refused", /1 to 10000/.test(String((await shape("branded-json-0009", "[]")).error?.message)));
expect("more than 10000 products a call is refused", /1 to 10000/.test(String((await shape("branded-json-0010", JSON.stringify(Array.from({ length: 10001 }, () => ({}))))).error?.message)));
expect("a batch name that does not start with branded- is refused", /must start with branded-/.test(String((await shape("fdc-2026-04-001", JSON.stringify([bar]))).error?.message)));
expect("no marker was written by any refused call", (await db.query("select count(*)::int n from public.usda_load_batches")).rows[0].n === 2);
const definer = (await db.query("select prosecdef, proconfig from pg_proc where proname = 'load_usda_branded_batch'")).rows[0];
expect("it runs as its owner with its search path set", definer?.prosecdef === true && (definer?.proconfig ?? []).includes("search_path=public"));

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
