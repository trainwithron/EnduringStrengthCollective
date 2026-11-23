// Imports USDA FoodData Central's Branded Foods (packaged products: brand, name, barcode, serving, kcal and six nutrients) into public.usda_branded_foods (migration 0468), as
// atomic, resumable SQL batches. Ron, Nov 23: the food search rebuild, part B.
//
//   node scripts/usda-branded-import.mjs <folder with the Branded Foods CSV files>                       (dry run: reads the files, prints what it WOULD load, writes nothing)
//   node scripts/usda-branded-import.mjs <folder> --name branded-2026-10 --out <dir> [--max-bytes 1400000]
//
// Download "Branded Foods" (CSV) from https://fdc.nal.usda.gov/download-datasets.html, unzip it into a folder of its own OUTSIDE the repo so it holds branded_food.csv, food.csv,
// nutrient.csv and food_nutrient.csv, and point this at it (never run anything from inside that folder). Every file is streamed: food_nutrient.csv has tens of millions of lines.
//
// --out writes ONE statement per batch (batch-001.sql, ...), each kept under --max-bytes of SQL so it fits one database call. Each batch loads completely or not at all and records
// itself in public.usda_load_batches, so running it again does nothing; an interrupted load is simply run again from the first file. A later USDA release is loaded under a new
// --name: products are updated in place, and one USDA republished under a new fdc_id replaces the old row with the same barcode. This script is never run by the app or a deploy.
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { parseCsv } from "./usda-lib.mjs";
import { addBranded, addFoodRow, addNutrientRow, buildBrandedNutrientIndex, createRecordReader, finalizeBranded, planBrandedBatches, toBrandedBatchSql } from "./usda-branded-lib.mjs";

const args = process.argv.slice(2);
const FLAGS_WITH_VALUE = ["--out", "--name", "--max-bytes"];
const folder = args.find((a, i) => !a.startsWith("--") && !FLAGS_WITH_VALUE.includes(args[i - 1]));
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const outDir = valueOf("--out");
const name = valueOf("--name");
const maxBytes = Number(valueOf("--max-bytes") ?? 1_400_000);

if (!folder) {
  console.error("Usage: node scripts/usda-branded-import.mjs <folder with branded_food.csv, food.csv, nutrient.csv, food_nutrient.csv> [--name <batch prefix> --out <dir> [--max-bytes 1400000]]");
  process.exit(1);
}
if (outDir && (!name || !/^branded-[a-z0-9][a-z0-9-]{1,52}$/.test(name))) {
  console.error("--out needs --name, a short lower-case label for this load that starts with branded-, such as branded-2026-10 (it names the batches, so running them again is a no-op; step 224's undo clears the branded- markers).");
  process.exit(1);
}
if (!Number.isInteger(maxBytes) || maxBytes < 100_000 || maxBytes > 5_000_000) {
  console.error("--max-bytes must be a whole number from 100000 to 5000000.");
  process.exit(1);
}
for (const f of ["branded_food.csv", "food.csv", "nutrient.csv", "food_nutrient.csv"]) {
  if (!existsSync(join(folder, f))) {
    console.error(`Missing ${f} in ${folder}`);
    process.exit(1);
  }
}

const warnings = [];
const warn = (m) => warnings.push(m);

// Streams a CSV whose quoted fields may hold line breaks, calling onRow with each row as an object.
async function streamCsv(file, onRow) {
  const reader = createRecordReader();
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header = null;
  let rows = 0;
  for await (const line of rl) {
    if (line === "" && reader.leftover() === null) continue;
    const cells = reader.push(line);
    if (!cells) continue;
    if (!header) {
      header = cells;
      continue;
    }
    onRow(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
    rows++;
  }
  if (reader.leftover() !== null) warn(`${file}: the last record was never closed (a broken file?): skipped`);
  return rows;
}

const index = new Map();
const brandedLines = await streamCsv(join(folder, "branded_food.csv"), (r) => addBranded(index, r));
let foodsMatched = 0;
await streamCsv(join(folder, "food.csv"), (r) => {
  if (addFoodRow(index, r)) foodsMatched++;
});
const nutrientIndex = buildBrandedNutrientIndex(parseCsv(readFileSync(join(folder, "nutrient.csv"), "utf8")), warn);
await streamCsv(join(folder, "food_nutrient.csv"), (r) => addNutrientRow(index, nutrientIndex, r));
const { rows, skipped } = finalizeBranded(index);

console.log(`Branded products in branded_food.csv: ${brandedLines}; with a name in food.csv: ${foodsMatched}`);
console.log(`Products to load: ${rows.length} (with a barcode: ${rows.filter((r) => r.gtin).length})`);
console.log(`Skipped: no name ${skipped.noName}, no kcal ${skipped.noKcal}, no protein/carbs/fat ${skipped.noMacros}, a value out of range ${skipped.outOfRange}, an older row for the same barcode ${skipped.olderDuplicate}`);
for (const w of warnings) console.warn(`warning: ${w}`);

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const groups = planBrandedBatches(rows, maxBytes);
  const files = [];
  let totalBytes = 0;
  let largest = 0;
  groups.forEach((group, i) => {
    const file = `batch-${String(i + 1).padStart(4, "0")}.sql`;
    const sql = toBrandedBatchSql(`${name}-${String(i + 1).padStart(4, "0")}`, group);
    writeFileSync(join(outDir, file), sql);
    files.push(file);
    totalBytes += Buffer.byteLength(sql);
    largest = Math.max(largest, Buffer.byteLength(sql));
  });
  writeFileSync(join(outDir, "index.json"), JSON.stringify({ name, maxBytes, products: rows.length, skipped, files, totalBytes, largestBatchBytes: largest }, null, 1));
  console.log(`Wrote ${files.length} batch files to ${outDir} (${(totalBytes / 1e6).toFixed(1)} MB in all, the largest ${(largest / 1e6).toFixed(2)} MB). Run them in order; each is all-or-nothing and a finished one is skipped if run again.`);
} else {
  console.log("Dry run only. Nothing was written. Add --name <label> --out <dir> to write the SQL batches.");
}
