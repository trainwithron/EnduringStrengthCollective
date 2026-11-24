// Rehearses step 226 (migration 0470, Ron Nov 23: food search round 2, "do 1 and 2"): the search forgives spelling mistakes, and the plain version of the ~100 most common foods
// comes first. On a stand-in shaped like live (steps 223-225 applied; real rows from fixtures/food-search-round2.json: the USDA foods as live had them on Nov 23, USDA Branded
// products, and the live-size word counts around the misspelled words tested), before and after the paste: the everyday searches (fixtures/everyday-searches.json, each with the
// USDA food that must come first), the misspellings, the word list's triggers and refresh, who may read and call what, the undo back to exactly step 225, and the paste again.
// The same paste was run on all 13,694 live foods and all 439,429 Branded products (42,507 words; each correction 50 to 130 ms in PGlite).
//   node scripts/sql-tests/food-search-round2.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";

const LF = String.fromCharCode(10);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, LF);
const db = new PGlite({ extensions: { pg_trgm } });
const failures = [];
const expect = (name, cond, extra = "") => {
  if (!cond) failures.push(name + (extra ? ` (${extra})` : ""));
};
const fixture = JSON.parse(read("./fixtures/food-search-round2.json"));
const SEARCHES = JSON.parse(read("./fixtures/everyday-searches.json"));

await db.exec(`
  create schema extensions;
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  create table public.usda_foods (fdc_id integer primary key, description text not null, data_type text not null check (data_type in ('Foundation', 'SR Legacy')), food_category text, created_at timestamptz not null default now());
  create table public.usda_food_nutrients (id uuid primary key default gen_random_uuid(), fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade, nutrient_key text not null, amount_per_100g numeric not null, unique (fdc_id, nutrient_key));
  create table public.usda_food_portions (id bigint generated always as identity primary key, fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade, seq integer not null, description text not null, gram_weight numeric not null, unique (fdc_id, seq));
  create table public.usda_load_batches (name text primary key, rows_loaded integer not null, loaded_at timestamptz not null default now());
  grant select on public.usda_foods, public.usda_food_nutrients, public.usda_food_portions to authenticated;
`);
const lastRow = (results) => results[results.length - 1].rows;
const oneRowAllTrue = (rows) => rows.length === 1 && Object.values(rows[0]).length > 0 && Object.values(rows[0]).every((v) => v === true);
// live today: steps 223 (0467), 224 (0468) and 225 (0469)
let r = lastRow(await db.exec(read("../../supabase/apply/apply-step223-0467.sql")));
expect("step 223 applies (as live)", oneRowAllTrue(r), JSON.stringify(r[0]));
await db.exec(read("../../supabase/migrations/0468_usda_branded_foods.sql"));
await db.exec(read("../../supabase/migrations/0469_food_search_eggs.sql"));
const md5 = async () => (await db.query(`select md5(replace(prosrc, chr(13), '')) m from pg_proc where oid = 'public.search_usda_foods(text[], integer)'::regprocedure`)).rows[0].m;
const LIVE_225 = "e3ad35e6b129ca09d07c778a931c7fbc";
expect("the step 225 search here is the live one", (await md5()) === LIVE_225, await md5());

const FOOD_COLS = "fdc_id integer, description text, data_type text, food_category text, plain_name text, extra_names text, common boolean";
await db.query(`insert into public.usda_foods (fdc_id, description, data_type, food_category, plain_name, extra_names, common) select * from jsonb_to_recordset($1::jsonb) as x(${FOOD_COLS})`, [JSON.stringify(fixture.foods)]);
const BRANDED_COLS =
  "fdc_id integer, gtin text, brand_owner text, brand_name text, description text, category text, serving_size numeric, serving_size_unit text, household_serving text, kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sugars_g numeric, sodium_mg numeric, published_date date";
const insertBranded = (rows) =>
  db.query(
    `insert into public.usda_branded_foods (fdc_id, gtin, brand_owner, brand_name, description, category, serving_size, serving_size_unit, household_serving, kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sodium_mg, published_date)
     select * from jsonb_to_recordset($1::jsonb) as r(${BRANDED_COLS})`,
    [JSON.stringify(rows)]
  );
// the products misspelled "chiken" themselves (3 live) are added after the paste, through the trigger
const misspelled = fixture.branded.filter((b) => /\bchiken\b/i.test(`${b.brand_owner ?? ""} ${b.brand_name ?? ""} ${b.description}`));
expect("the fixture has the live products misspelled 'chiken'", misspelled.length === 3, String(misspelled.length));
await insertBranded(fixture.branded.filter((b) => !misspelled.includes(b)));

const tokenize = (q) => [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 || /\d/.test(w)))].slice(0, 6);
const asRole = async (role, fn) => {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
  }
};
const firstOf = (q) => asRole("authenticated", async () => (await db.query(`select description from public.search_usda_foods($1::text[], 25)`, [tokenize(q)])).rows[0]?.description ?? null);
const everydayCount = (q) => asRole("authenticated", async () => (await db.query(`select count(*)::int n from public.search_usda_foods($1::text[], 25)`, [tokenize(q)])).rows[0].n);
const packaged = (q) => asRole("authenticated", async () => (await db.query(`select description from public.search_branded_foods($1::text[], 10)`, [tokenize(q)])).rows.map((x) => x.description));
const correct = (q) => asRole("authenticated", async () => (await db.query(`select public.correct_food_search_words($1::text[]) w`, [tokenize(q)])).rows[0].w.join(" "));

// ---- before (live today) ----
expect("before: 'egg whites' puts the omelet with meat first (the live miss)", (await firstOf("egg whites")) === "Egg white, omelet, scrambled, or fried, with meat", await firstOf("egg whites"));
expect("before: 'chiken breast' finds nothing at all", (await everydayCount("chiken breast")) === 0 && (await packaged("chiken breast")).length === 0);
expect("before: no pg_trgm (live has none)", (await db.query(`select count(*)::int n from pg_extension where extname = 'pg_trgm'`)).rows[0].n === 0);
let wrongBefore = 0;
for (const s of SEARCHES) if ((await firstOf(s.search)) !== s.first) wrongBefore++;
expect("before: about 30 of the everyday searches give something other than the plain food first", wrongBefore >= 25 && wrongBefore <= 40, String(wrongBefore));

// ---- the paste ----
const migration = read("../../supabase/migrations/0470_food_search_typos_plain_first.sql");
const apply = read("../../supabase/apply/apply-step226-0470.sql");
const undo = read("../../supabase/apply/undo-step226-0470.sql");
const ascii = (s) => [...s].every((c) => c.charCodeAt(0) < 128);
expect("paste holds the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo are plain ASCII", ascii(apply) && ascii(undo));
const m0469 = read("../../supabase/migrations/0469_food_search_eggs.sql");
const fn0469 = m0469.slice(m0469.indexOf("create or replace function public.search_usda_foods("), m0469.indexOf("grant execute on function public.search_usda_foods(text[], integer) to authenticated, service_role;"));
expect("undo holds step 225's search word for word", fn0469.length > 1000 && undo.includes(fn0469));
r = lastRow(await db.exec(apply));
expect("paste 226: one row, all true", oneRowAllTrue(r), JSON.stringify(r[0]));
await db.exec(migration);
expect("the migration runs again on top (re-running is safe)", oneRowAllTrue(lastRow(await db.exec(apply.slice(apply.indexOf("-- Check: one row, all true."))))));

// ---- 2. the plain version first ----
for (const s of SEARCHES) {
  const got = await firstOf(s.search);
  expect(`"${s.search}" gives ${s.first} first`, got === s.first, String(got));
}
const RON = { "whole milk": "Milk, whole", "2% milk": "Milk, reduced fat (2%)", "sourdough bread": "Bread, sour dough", "french bread": "Bread, French or Vienna", banana: "Banana, raw" };
for (const [q, d] of Object.entries(RON)) expect(`Ron's "${q}" unchanged`, (await firstOf(q)) === d, await firstOf(q));
const plain = async (d) => (await db.query(`select plain_name, common from public.usda_foods where data_type = 'Survey (FNDDS)' and description = $1`, [d])).rows[0];
expect("names: 'Egg whites, cooked' (common)", JSON.stringify(await plain("Egg, white, cooked, no added fat")) === JSON.stringify({ plain_name: "Egg whites, cooked", common: true }));
expect("names: the walnuts are 'Walnuts', not 'Excluding honey roasted walnuts'", (await plain("Walnuts, excluding honey roasted")).plain_name === "Walnuts");
expect("names: a name the same as USDA's is no plain name ('Coffee, brewed')", JSON.stringify(await plain("Coffee, brewed")) === JSON.stringify({ plain_name: null, common: true }));

// ---- 1. forgiving spelling ----
// the live-size counts around the words tested (a fixture of 900 foods has a few hundred of each word; live has thousands)
await db.query(`insert into public.food_search_words (word, uses) select x.w, x.n from jsonb_to_recordset($1::jsonb) as x(w text, n integer) on conflict (word) do update set uses = excluded.uses`, [
  JSON.stringify(fixture.words.map(([w, n]) => ({ w, n }))),
]);
await insertBranded(misspelled);
expect("the trigger added 'chiken' from the 3 misspelled products", (await db.query(`select uses from public.food_search_words where word = 'chiken'`)).rows[0]?.uses >= 3);
const TYPOS = { "chiken breast": "chicken breast", brocoli: "broccoli", bananna: "banana", yogrt: "yogurt", cheerois: "cheerios" };
for (const [typed, meant] of Object.entries(TYPOS)) {
  expect(`before the retry: "${typed}" finds nothing`, (await everydayCount(typed)) === 0 && (await packaged(typed)).length === 0);
  const t0 = Date.now();
  const got = await correct(typed);
  const ms = Date.now() - t0;
  expect(`"${typed}" is read as "${meant}"`, got === meant, got);
  expect(`"${typed}" is corrected quickly`, ms < 3000, `${ms} ms`);
}
expect("chiken breast -> chicken breast first", (await firstOf("chicken breast")) === "Chicken breast, baked, broiled, or roasted, skin not eaten, from raw", await firstOf("chicken breast"));
expect("brocoli -> broccoli first", (await firstOf("broccoli")) === "Broccoli, raw");
expect("bananna -> banana first", (await firstOf("banana")) === "Banana, raw");
expect("yogrt -> a yogurt first", /yogurt/i.test((await firstOf("yogurt")) ?? ""));
expect("cheerois -> Cheerios in Packaged foods", (await packaged("cheerios")).some((d) => /cheerios/i.test(d)), JSON.stringify((await packaged("cheerios")).slice(0, 3)));
// misspellings printed on a few real products (live: avacado, tumeric, protien, yougurt, choclate each on 1 to 11): the search finds those, so the app shows them as typed and
// offers "Did you mean ...?" with these words
const OFFERED = { avacado: "avocado", tumeric: "turmeric", "protien bar": "protein bar", "greek yougurt": "greek yogurt", "choclate milk": "chocolate milk" };
for (const [typed, meant] of Object.entries(OFFERED)) {
  const word = tokenize(typed).find((w) => !meant.split(" ").includes(w));
  expect(`"${word}" is on real products (so "${typed}" finds something as typed)`, (await db.query(`select count(*)::int n from public.usda_branded_foods where search @@ to_tsquery('simple', $1)`, [word])).rows[0].n > 0);
  expect(`"${typed}": Did you mean "${meant}"`, (await correct(typed)) === meant, await correct(typed));
}
for (const kept of ["whole milk", "2% milk", "chicken breast", "greek yogurt"]) expect(`"${kept}" is never changed`, (await correct(kept)) === tokenize(kept).join(" "), await correct(kept));
expect("a number stays a number ('2% milk')", (await correct("2% milk")) === "2 milk");
expect("gibberish stays as typed (so it still finds nothing)", (await correct("xqzv")) === "xqzv" && (await everydayCount("xqzv")) === 0);
expect("swaps the misspelled word only", (await correct("chiken xqzv breast")) === "chicken xqzv breast");
expect("a misspelling on 3 products still gives way to the word on thousands", (await db.query(`select uses from public.food_search_words where word = 'chicken'`)).rows[0].uses >= 20 * 3);
const dist = async (a, b) => (await db.query(`select public.food_word_distance($1, $2) d`, [a, b])).rows[0].d;
expect("two letters swapped are one slip", (await dist("cheerois", "cheerios")) === 1);
expect("a letter missing is one slip", (await dist("yogrt", "yogurt")) === 1 && (await dist("chiken", "chicken")) === 1);
expect("cheers is two slips from cheerois", (await dist("cheerois", "cheers")) === 2);

// ---- the word list: triggers, refresh, access ----
const uses = async (w) => (await db.query(`select uses from public.food_search_words where word = $1`, [w])).rows[0]?.uses ?? null;
await insertBranded([{ fdc_id: 990000001, gtin: null, brand_owner: "Quux Farms", brand_name: null, description: "QUUXBERRY CRISPS", category: null, serving_size: null, serving_size_unit: null, household_serving: null, kcal: 100, protein_g: 1, carbs_g: null, fat_g: null, fiber_g: null, sugars_g: null, sodium_mg: null, published_date: null }]);
expect("a new product's words are in the list at once", (await uses("quuxberry")) === 1 && (await uses("quux")) === 1);
await db.exec(`update public.usda_branded_foods set description = 'QUUXBERRY ZORBLAT CRISPS' where fdc_id = 990000001`);
expect("a changed product adds its new words, without counting the old ones twice", (await uses("zorblat")) === 1 && (await uses("quuxberry")) === 1);
await db.exec(`insert into public.usda_foods (fdc_id, description, data_type, plain_name, common) values (990000002, 'Quuxfruit, raw', 'Survey (FNDDS)', 'Quuxfruit', true)`);
expect("a new USDA food's words are in the list at once", (await uses("quuxfruit")) === 2);
const refreshed = (await db.query(`select public.refresh_food_search_words() n`)).rows[0].n;
expect("refresh rebuilds the whole list from the tables", refreshed === (await db.query(`select count(*)::int n from public.food_search_words`)).rows[0].n && (await uses("quuxberry")) === 1 && (await uses("chiken")) >= 3);
await db.exec(`delete from public.usda_branded_foods where fdc_id = 990000001; delete from public.usda_foods where fdc_id = 990000002;`);
const tryAs = async (role, sql) => {
  try {
    await asRole(role, () => db.query(sql));
    return true;
  } catch {
    return false;
  }
};
expect("signed in: reads the word list and corrects", (await tryAs("authenticated", `select count(*) from public.food_search_words`)) && (await tryAs("authenticated", `select public.correct_food_search_words(array['brocoli'])`)));
expect("signed in: cannot write the word list", !(await tryAs("authenticated", `insert into public.food_search_words (word, uses) values ('zzzz', 1)`)));
expect("signed in: cannot rebuild it", !(await tryAs("authenticated", `select public.refresh_food_search_words()`)));
expect("signed out: neither", !(await tryAs("anon", `select count(*) from public.food_search_words`)) && !(await tryAs("anon", `select public.correct_food_search_words(array['brocoli'])`)));
expect("the server key may rebuild it", await tryAs("service_role", `select public.refresh_food_search_words()`));
const plan = (await db.query(`explain select word from public.food_search_words where word operator(extensions.%) 'cheerois'`)).rows.map((x) => x["QUERY PLAN"]).join(" ");
expect("the trigram index exists for the lookup", (await db.query(`select count(*)::int n from pg_indexes where indexname = 'food_search_words_trgm_idx'`)).rows[0].n === 1, plan);

// ---- undo, then the paste again ----
r = lastRow(await db.exec(undo));
expect("undo: one row, all true", oneRowAllTrue(r), JSON.stringify(r[0]));
expect("undo: the search is exactly step 225's again (the live md5)", (await md5()) === LIVE_225);
expect("undo: 'egg whites' back as live", (await firstOf("egg whites")) === "Egg white, omelet, scrambled, or fried, with meat");
const named = (await db.query(`select fdc_id, plain_name, common from public.usda_foods order by fdc_id`)).rows;
const live = new Map(fixture.foods.map((f) => [f.fdc_id, f]));
expect("undo: every name and flag as live had them", named.every((x) => live.get(x.fdc_id) && (live.get(x.fdc_id).plain_name ?? null) === (x.plain_name ?? null) && live.get(x.fdc_id).common === x.common));
// The paste's own check reads "chiken breast" against live-size counts (chicken on 14,006 products against 3): with the 3 misspelled products in, this fixture's few hundred
// "chicken" are too few for the 20 times rule, so they go out again before the paste is run a second time.
await db.query(`delete from public.usda_branded_foods where fdc_id = any($1::int[])`, [misspelled.map((b) => b.fdc_id)]);
r = lastRow(await db.exec(apply));
expect("paste again: one row, all true", oneRowAllTrue(r), JSON.stringify(r[0]));
expect("paste again: 'egg whites' gives the cooked egg whites first", (await firstOf("egg whites")) === "Egg, white, cooked, no added fat");

if (failures.length) {
  console.error(`FAIL step 226 rehearsal: ${failures.length} failed`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`ok step 226 rehearsal (${SEARCHES.length} everyday searches, ${Object.keys(TYPOS).length} misspellings, undo and paste again)`);
