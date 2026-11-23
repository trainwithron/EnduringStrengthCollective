// Rehearses step 223 (migration 0467): the food search with USDA's everyday foods (FNDDS). On an in-memory Postgres shaped like live (the USDA tables of 0163 and 0300, the live
// search function of 0300, a few SR Legacy and Foundation foods), it applies the paste, loads the hand-made FNDDS sample (scripts/sql-tests/fixtures/fndds-sample, the FoodData
// Central CSV format) through the real importer's batches, and checks what Ron asked for: "whole milk" gives whole milk, "2% milk" exactly 2% milk, "sourdough bread" sourdough bread,
// "french bread" French bread, a plain cooked chicken breast near the top, and never the same name twice. Then the undo, and the paste again.
//   node scripts/sql-tests/food-search-fndds.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LF = String.fromCharCode(10);
const lf = (s) => s.replace(/\r\n/g, LF);
const read = (p) => lf(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = new PGlite();
const failures = [];
const expect = (name, cond, extra = "") => {
  if (!cond) failures.push(name + (extra ? ` (${extra})` : ""));
};

// ---- live-shaped stand-in ----
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.usda_foods (
    fdc_id integer primary key,
    description text not null,
    data_type text not null check (data_type in ('Foundation', 'SR Legacy')),
    food_category text,
    created_at timestamptz not null default now()
  );
  create table public.usda_food_nutrients (
    id uuid primary key default gen_random_uuid(),
    fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade,
    nutrient_key text not null,
    amount_per_100g numeric not null,
    unique (fdc_id, nutrient_key)
  );
  create table public.usda_food_portions (
    id bigint generated always as identity primary key,
    fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade,
    seq integer not null, description text not null, gram_weight numeric not null, unique (fdc_id, seq)
  );
  create table public.usda_load_batches (name text primary key, rows_loaded integer not null, loaded_at timestamptz not null default now());
  alter table public.usda_foods enable row level security;
  create policy "usda_foods_select_all" on public.usda_foods for select to authenticated using (true);
  alter table public.usda_food_nutrients enable row level security;
  create policy "usda_food_nutrients_select_all" on public.usda_food_nutrients for select to authenticated using (true);
  grant select on public.usda_foods, public.usda_food_nutrients, public.usda_food_portions to authenticated;
`);
const m0300 = read("../../supabase/migrations/0300_food_search_logging.sql");
const fn0300 = m0300.slice(m0300.indexOf("create or replace function public.search_usda_foods"), m0300.indexOf("grant execute on function public.search_usda_foods(text[], integer) to authenticated, service_role;") + 200);
await db.exec(fn0300.slice(0, fn0300.indexOf("service_role;") + "service_role;".length));
const fnMd5 = async () => (await db.query(`select md5(replace(prosrc, chr(13), '')) m from pg_proc where proname = 'search_usda_foods'`)).rows[0]?.m;
expect("the stand-in search is the live one (0300)", (await fnMd5()) === "ddf683e15f560d97fa552ae06ea5b097", await fnMd5());

// SR Legacy and Foundation foods like the live ones, and the duplicates the live list has (138 names twice or more)
const sr = [
  [171265, "Milk, whole, 3.25% milkfat, with added vitamin D", "SR Legacy", [61, 3.15, 4.8, 3.25]],
  [171266, "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", "SR Legacy", [50, 3.3, 4.8, 1.98]],
  [174832, "Bread, french or vienna (includes sourdough)", "SR Legacy", [272, 10.75, 51.88, 2.42]],
  [172686, "Bread, white, commercially prepared (includes soft bread crumbs)", "SR Legacy", [266, 7.64, 50.61, 3.29]],
  [172687, "Bread, white, commercially prepared (includes soft bread crumbs)", "SR Legacy", [267, 7.7, 50.6, 3.3]],
  [999001, "Bread, white", "SR Legacy", [270, 9.0, 50.0, 3.2]],
  [171477, "Chicken, broilers or fryers, breast, meat only, cooked, roasted", "SR Legacy", [165, 31.02, 0, 3.57]],
  [2646170, "Milk, whole, 3.25% milkfat, with added vitamin D", "Foundation", [61, 3.27, 4.63, 3.2]],
];
for (const [id, d, t, [kcal, p, c, f]] of sr) {
  await db.query(`insert into public.usda_foods (fdc_id, description, data_type) values ($1, $2, $3)`, [id, d, t]);
  for (const [k, v] of [["kcal", kcal], ["protein_g", p], ["carbs_g", c], ["fat_g", f]]) await db.query(`insert into public.usda_food_nutrients (fdc_id, nutrient_key, amount_per_100g) values ($1, $2, $3)`, [id, k, v]);
}
const beforeCounts = (await db.query(`select count(*)::int n from public.usda_foods`)).rows[0].n;

// ---- the paste (and the migration itself, twice: re-running is safe) ----
const migration = read("../../supabase/migrations/0467_food_search_everyday_foods.sql");
const apply = read("../../supabase/apply/apply-step223-0467.sql");
const undo = read("../../supabase/apply/undo-step223-0467.sql");
const ascii = (s) => [...s].every((c) => c.charCodeAt(0) < 128);
expect("paste holds the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo are plain ASCII", ascii(apply) && ascii(undo));
const lastRow = (results) => results[results.length - 1].rows;
const oneRowAllTrue = (rows) => rows.length === 1 && Object.values(rows[0]).length > 0 && Object.values(rows[0]).every((v) => v === true);
const shown = (rows) => JSON.stringify(rows[0]);

let r = lastRow(await db.exec(apply));
expect("paste: one row, all true", oneRowAllTrue(r), shown(r));
await db.exec(migration);
r = lastRow(await db.exec(apply));
expect("paste again: one row, all true (re-running is safe)", oneRowAllTrue(r), shown(r));
expect("no food was touched by the paste", (await db.query(`select count(*)::int n from public.usda_foods`)).rows[0].n === beforeCounts);

// ---- the everyday foods, loaded by the real importer's batches (twice: a finished batch is skipped) ----
const out = mkdtempSync(join(tmpdir(), "fndds-batches-"));
const importer = fileURLToPath(new URL("../usda-import.mjs", import.meta.url));
const sample = fileURLToPath(new URL("./fixtures/fndds-sample/", import.meta.url));
execFileSync(process.execPath, [importer, sample, "--name", "fndds-rehearsal", "--out", out, "--batch-size", "10"], { stdio: "pipe" });
const batches = readdirSync(out).filter((f) => f.endsWith(".sql")).sort();
expect("the importer wrote batches", batches.length === 2, batches.join(","));
for (let pass = 0; pass < 2; pass++) for (const b of batches) await db.exec(readFileSync(join(out, b), "utf8"));
rmSync(out, { recursive: true, force: true });
const loaded = (await db.query(`select count(*)::int n, count(plain_name)::int named, count(*) filter (where common)::int common, count(extra_names)::int extra from public.usda_foods where data_type = 'Survey (FNDDS)'`)).rows[0];
expect("15 everyday foods loaded once, with plain names, hand-named ones and other names", loaded.n === 15 && loaded.named === 10 && loaded.common === 10 && loaded.extra === 3, JSON.stringify(loaded));
expect("their nutrients and portions came too", (await db.query(`select count(*)::int n from public.usda_food_nutrients where fdc_id between 2705000 and 2710000`)).rows[0].n === 60 && (await db.query(`select count(*)::int n from public.usda_food_portions`)).rows[0].n === 7);
expect("whole milk is named Whole milk, USDA's name kept", (await db.query(`select plain_name, description from public.usda_foods where fdc_id = 2705385`)).rows[0].plain_name === "Whole milk");

// ---- the searches, the way the app calls it (lib/food-search.ts tokenize), as a signed-in person ----
const tokenize = (query) => [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 || /\d/.test(w)))].slice(0, 6);
const search = async (query, limit = 25) => {
  await db.exec(`set role authenticated`);
  try {
    return (await db.query(`select * from public.search_usda_foods($1::text[], $2)`, [tokenize(query), limit])).rows;
  } finally {
    await db.exec(`reset role`);
  }
};
const firstId = async (q) => (await search(q))[0]?.fdc_id;
const list = async (q) => (await search(q)).map((x) => `${x.fdc_id} ${x.description}`).join(" | ");
expect('"whole milk" gives Milk, whole first', (await firstId("whole milk")) === 2705385, await list("whole milk"));
expect('"2% milk" gives Milk, reduced fat (2%) first', (await firstId("2% milk")) === 2705386, await list("2% milk"));
expect('"1% milk" gives Milk, low fat (1%) first', (await firstId("1% milk")) === 2705387, await list("1% milk"));
expect('"skim milk" gives Milk, fat free (skim) first', (await firstId("skim milk")) === 2705388, await list("skim milk"));
expect('"nonfat milk" gives Milk, fat free (skim) first', (await firstId("nonfat milk")) === 2705388, await list("nonfat milk"));
expect('"sourdough bread" gives Bread, sour dough first', (await firstId("sourdough bread")) === 2707646, await list("sourdough bread"));
expect('"sourdough" alone finds it too', (await search("sourdough")).some((x) => x.fdc_id === 2707646), await list("sourdough"));
expect('"french bread" gives Bread, French or Vienna first', (await firstId("french bread")) === 2707647, await list("french bread"));
const chicken = await search("chicken breast");
expect('"chicken breast": a plain cooked chicken breast in the top 3', chicken.slice(0, 3).some((x) => x.fdc_id === 2705900), chicken.map((x) => x.fdc_id).join(","));
expect('"banana" gives Banana, raw first', (await firstId("banana")) === 2709100, await list("banana"));
// every row carries its plain name (null when it would repeat USDA's)
expect("the plain name comes back with each row", (await search("whole milk"))[0].plain_name === "Whole milk");
// one row per name, everyday first, SR Legacy still there below
for (const q of ["milk", "bread", "white bread", "chicken", "bread white", "milk whole"]) {
  const rows = await search(q, 100);
  const names = rows.map((x) => x.description.toLowerCase());
  expect(`"${q}": no name twice`, new Set(names).size === names.length, names.join(" | "));
}
const white = await search("bread white", 100);
expect('"Bread, white" (FNDDS and SR Legacy both) shows once, the FNDDS one', white.filter((x) => x.description === "Bread, white").length === 1 && white.find((x) => x.description === "Bread, white").data_type === "Survey (FNDDS)");
expect("the SR Legacy name listed twice shows once", white.filter((x) => x.description.startsWith("Bread, white, commercially prepared")).length === 1);
const milk = await search("milk", 100);
const lastEveryday = Math.max(...milk.map((x, i) => (x.data_type === "Survey (FNDDS)" ? i : -1)));
const firstSr = milk.findIndex((x) => x.data_type === "SR Legacy");
expect("SR Legacy foods still appear for milk, after the everyday ones", firstSr > -1 && firstSr > lastEveryday, milk.map((x) => x.data_type).join(","));
expect("the macros come with each row", Number(milk[0].kcal) > 0 && milk[0].protein_g != null);
expect("an empty or junk search returns nothing", (await search("")).length === 0 && (await db.query(`select count(*)::int n from public.search_usda_foods(array['%', '_'], 5)`)).rows[0].n === 0);
expect("at most 100 rows", (await db.query(`select count(*)::int n from public.search_usda_foods(array['a1'], 1000)`)).rows[0].n <= 100);

// ---- who can do what ----
await db.exec(`set role authenticated`);
let wrote = null;
try {
  await db.query(`insert into public.food_search_synonyms values ('x', 'y z')`);
} catch (e) {
  wrote = e.message;
}
await db.exec(`reset role`);
expect("a signed-in person cannot add a synonym", !!wrote);
expect("a signed-out person cannot search", (await db.query(`select has_function_privilege('anon', 'public.search_usda_foods(text[], integer)', 'execute') p`)).rows[0].p === false);

// ---- the undo, with everyday foods loaded: the old search is back, the foods and their names are kept ----
r = lastRow(await db.exec(undo));
expect("undo (everyday foods loaded): one row, all true", oneRowAllTrue(r), shown(r));
expect("undo: the search is exactly the live one again", (await fnMd5()) === "ddf683e15f560d97fa552ae06ea5b097");
expect("undo: no food deleted, names kept", (await db.query(`select count(*)::int n, count(plain_name)::int named from public.usda_foods where data_type = 'Survey (FNDDS)'`)).rows[0].named === 10);
expect("undo: the old search still finds the everyday foods", (await db.query(`select count(*)::int n from public.search_usda_foods(array['milk'], 50) where data_type = 'Survey (FNDDS)'`)).rows[0].n > 0);
r = lastRow(await db.exec(apply));
expect("paste again after the undo: one row, all true", oneRowAllTrue(r), shown(r));
expect("and whole milk is first again", (await firstId("whole milk")) === 2705385);

// ---- the undo before any everyday food is loaded: everything as it was ----
await db.exec(`delete from public.usda_foods where data_type = 'Survey (FNDDS)'`);
r = lastRow(await db.exec(undo));
expect("undo (no everyday foods): one row, all true", oneRowAllTrue(r), shown(r));
expect("undo: the name columns are gone and the data type rule is as before", (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'usda_foods' and column_name in ('plain_name', 'extra_names', 'common')`)).rows[0].n === 0);
let refused = null;
try {
  await db.query(`insert into public.usda_foods (fdc_id, description, data_type) values (1, 'x', 'Survey (FNDDS)')`);
} catch (e) {
  refused = e.message;
}
expect("undo: an everyday food is refused again", !!refused);
r = lastRow(await db.exec(apply));
expect("paste once more: one row, all true", oneRowAllTrue(r), shown(r));

if (failures.length) {
  console.error("FAILED:" + LF + "- " + failures.join(LF + "- "));
  process.exit(1);
}
console.log("OK: step 223 rehearsal passed");
