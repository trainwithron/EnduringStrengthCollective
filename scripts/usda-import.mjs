// Imports USDA FoodData Central (Foundation Foods + SR Legacy): the foods, EVERY nutrient the app shows (the fuller vitamin and mineral panel) and the household portions
// ("1 cup, chopped" = 140 g), as atomic, resumable SQL batches.
//
//   node scripts/usda-import.mjs <folder with the USDA CSV files>                       (dry run: reads the files, prints what it WOULD load, writes nothing)
//   node scripts/usda-import.mjs <folder> --name fdc-2026-04 --out <dir> [--batch-size 150]
//
// Download the CSV zips from https://fdc.nal.usda.gov/download-datasets.html (Foundation Foods and SR Legacy), unzip them into one folder so it holds food.csv, food_category.csv,
// nutrient.csv, food_nutrient.csv, and (for portions) food_portion.csv and measure_unit.csv, and point this at it.
//
// --out writes ONE statement per batch (batch-001.sql, batch-002.sql, ...). Each batch loads completely or not at all, and records itself in public.usda_load_batches when it is
// done, so running a batch again does nothing: an interrupted load is simply run again from the first file. There is deliberately no mode that writes straight to the database
// row by row, because that can leave a food half loaded. This script is never run by the app or by a deploy; a person runs it, on purpose, and runs the batches only when told to.
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { buildFoods, buildNutrientIndex, chunk, createNutrientCollector, parseCsv, parseCsvLine, NUTRIENT_SOURCES } from "./usda-lib.mjs";
import { buildPortions, toBatchSql } from "./usda-batch-lib.mjs";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out" && args[args.indexOf(a) - 1] !== "--name" && args[args.indexOf(a) - 1] !== "--batch-size");
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const outDir = valueOf("--out");
const name = valueOf("--name");
const batchSize = Number(valueOf("--batch-size") ?? 150);

if (!folder) {
  console.error("Usage: node scripts/usda-import.mjs <folder with food.csv, food_category.csv, nutrient.csv, food_nutrient.csv, food_portion.csv, measure_unit.csv> [--name <batch prefix> --out <dir> [--batch-size 150]]");
  process.exit(1);
}
if (outDir && (!name || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(name))) {
  console.error("--out needs --name, a short lower-case label for this load such as fdc-2026-04 (it names the batches, so running them again is a no-op).");
  process.exit(1);
}
if (!Number.isInteger(batchSize) || batchSize < 10 || batchSize > 1000) {
  console.error("--batch-size must be a whole number from 10 to 1000.");
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

let portionRows = [];
if (existsSync(join(folder, "food_portion.csv")) && existsSync(join(folder, "measure_unit.csv"))) {
  portionRows = buildPortions(parseCsv(readFileSync(join(folder, "food_portion.csv"), "utf8")), parseCsv(readFileSync(join(folder, "measure_unit.csv"), "utf8")), foods);
} else {
  warn("food_portion.csv / measure_unit.csv not found: no household portions will be loaded (grams and ounces still work in the app).");
}

console.log(`Foods to import: ${foods.size}`);
console.log(`Nutrient rows to import: ${nutrientRows.length}`);
console.log(`Household portions to import: ${portionRows.length}`);
const perKey = new Map();
for (const n of nutrientRows) perKey.set(n.nutrient_key, (perKey.get(n.nutrient_key) ?? 0) + 1);
for (const key of Object.keys(NUTRIENT_SOURCES)) console.log(`  ${key.padEnd(15)} reported for ${String(perKey.get(key) ?? 0).padStart(5)} of ${foods.size} foods`);
for (const w of warnings) console.warn(`warning: ${w}`);

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const nutrientsByFood = new Map();
  for (const n of nutrientRows) (nutrientsByFood.get(n.fdc_id) ?? nutrientsByFood.set(n.fdc_id, []).get(n.fdc_id)).push(n);
  const portionsByFood = new Map();
  for (const p of portionRows) (portionsByFood.get(p.fdc_id) ?? portionsByFood.set(p.fdc_id, []).get(p.fdc_id)).push(p);
  const ids = [...foods.keys()].sort((a, b) => a - b);
  const files = [];
  chunk(ids, batchSize).forEach((group, i) => {
    const sub = new Map(group.map((id) => [id, foods.get(id)]));
    const file = `batch-${String(i + 1).padStart(3, "0")}.sql`;
    writeFileSync(join(outDir, file), toBatchSql(`${name}-${String(i + 1).padStart(3, "0")}`, sub, group.flatMap((id) => nutrientsByFood.get(id) ?? []), group.flatMap((id) => portionsByFood.get(id) ?? [])));
    files.push(file);
  });
  writeFileSync(join(outDir, "index.json"), JSON.stringify({ name, batchSize, foods: foods.size, nutrientRows: nutrientRows.length, portions: portionRows.length, files }, null, 1));
  console.log(`Wrote ${files.length} batch files to ${outDir}. Run them in order; each is all-or-nothing and a finished one is skipped if run again.`);
} else {
  console.log("Dry run only. Nothing was written. Add --name <label> --out <dir> to write the SQL batches.");
}
