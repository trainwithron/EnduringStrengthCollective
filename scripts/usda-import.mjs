// Imports USDA FoodData Central (Foundation Foods + SR Legacy) into public.usda_foods and public.usda_food_nutrients.
//
//   node scripts/usda-import.mjs <folder with the USDA CSV files> --out <folder for SQL files>
//   node scripts/usda-import.mjs <folder> --apply        (writes to the database named in the environment)
//
// Download the CSV zips from https://fdc.nal.usda.gov/download-datasets.html, unzip them into one folder so it holds food.csv,
// food_category.csv, nutrient.csv and food_nutrient.csv, and point this at it. By default nothing is written anywhere: it reads
// the files and prints what it WOULD import. --out writes upsert SQL files (500 foods each) you can run yourself. --apply
// upserts straight into the database using NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment. It is
// deliberately never run by the app or by a deploy; run it by hand, on purpose.
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { buildFoods, buildNutrientIndex, chunk, createNutrientCollector, parseCsv, parseCsvLine, toSql } from "./usda-lib.mjs";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? args[outIndex + 1] : null;

if (!folder) {
  console.error("Usage: node scripts/usda-import.mjs <folder with food.csv, food_category.csv, nutrient.csv, food_nutrient.csv> [--out <dir>] [--apply]");
  process.exit(1);
}
for (const f of ["food.csv", "nutrient.csv", "food_nutrient.csv"]) {
  if (!existsSync(join(folder, f))) {
    console.error(`Missing ${f} in ${folder}`);
    process.exit(1);
  }
}

const warnings = [];
const warn = (m) => warnings.push(m);

// food.csv and food_category.csv are small enough to read whole; food_nutrient.csv has millions of lines, so it is streamed.
const foodRows = parseCsv(readFileSync(join(folder, "food.csv"), "utf8"));
const categoryRows = existsSync(join(folder, "food_category.csv")) ? parseCsv(readFileSync(join(folder, "food_category.csv"), "utf8")) : [];
const foods = buildFoods(foodRows, categoryRows);
const nutrientIndex = buildNutrientIndex(parseCsv(readFileSync(join(folder, "nutrient.csv"), "utf8")), warn);
const collector = createNutrientCollector(foods, nutrientIndex);

const rl = createInterface({ input: createReadStream(join(folder, "food_nutrient.csv")), crlfDelay: Infinity });
let header = null;
for await (const line of rl) {
  if (!line) continue;
  const cells = parseCsvLine(line);
  if (!header) {
    header = cells;
    continue;
  }
  collector.add(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}
const nutrientRows = collector.rows();

console.log(`Foods to import: ${foods.size}`);
console.log(`Nutrient rows to import: ${nutrientRows.length}`);
for (const w of warnings) console.warn(`warning: ${w}`);

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const ids = [...foods.keys()].sort((a, b) => a - b);
  const nutrientsByFood = new Map();
  for (const n of nutrientRows) {
    const list = nutrientsByFood.get(n.fdc_id) ?? [];
    list.push(n);
    nutrientsByFood.set(n.fdc_id, list);
  }
  chunk(ids, 500).forEach((group, i) => {
    const sub = new Map(group.map((id) => [id, foods.get(id)]));
    const rows = group.flatMap((id) => nutrientsByFood.get(id) ?? []);
    writeFileSync(join(outDir, `usda-${String(i + 1).padStart(3, "0")}.sql`), toSql(sub, rows));
  });
  console.log(`Wrote SQL files to ${outDir}`);
}

if (apply) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("--apply needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" };
  async function upsert(table, rows, onConflict) {
    for (const group of chunk(rows, 500)) {
      const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, { method: "POST", headers, body: JSON.stringify(group) });
      if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    }
  }
  await upsert("usda_foods", [...foods.values()], "fdc_id");
  await upsert("usda_food_nutrients", nutrientRows, "fdc_id,nutrient_key");
  console.log("Applied.");
}

if (!outDir && !apply) console.log("Dry run only. Nothing was written. Add --out <dir> for SQL files or --apply to write to the database.");
