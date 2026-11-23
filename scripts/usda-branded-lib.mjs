// The pure parts of importing USDA FoodData Central's Branded Foods (packaged products with a label and, mostly, a barcode) into public.usda_branded_foods (migration 0468). No
// network, no database, so it is tested (lib/usda-branded-import.test.ts). Used by scripts/usda-branded-import.mjs.
//
// The Branded Foods CSV download holds branded_food.csv (brand, barcode, serving), food.csv (the name and publication date), nutrient.csv and food_nutrient.csv (USDA publishes the
// label's values converted to per 100 g, or per 100 ml for a drink). Only what the app shows is kept: the brand, name, barcode, serving, kcal and six nutrients, and the date.
import { parseCsvLine, sqlText } from "./usda-lib.mjs";

// App column -> USDA nutrient numbers, best source first, and the unit expected (the same numbers the Foundation / SR Legacy import uses; sugars is "Sugars, total including NLEA").
export const BRANDED_NUTRIENTS = {
  kcal: { numbers: ["208", "958", "957"], unit: "KCAL" },
  protein_g: { numbers: ["203"], unit: "G" },
  carbs_g: { numbers: ["205"], unit: "G" },
  fat_g: { numbers: ["204"], unit: "G" },
  fiber_g: { numbers: ["291"], unit: "G" },
  sugars_g: { numbers: ["269"], unit: "G" },
  sodium_mg: { numbers: ["307"], unit: "MG" },
};

// The same limits the table checks (a value outside them is a data error: the product is skipped, never loaded half right).
export const LIMITS = { kcal: 1000, protein_g: 200, carbs_g: 200, fat_g: 200, fiber_g: 200, sugars_g: 200, sodium_mg: 100000 };

// ---- CSV records that may span lines ----
// branded_food.csv carries ingredient lists, which can hold a line break inside quotes. Lines are fed in; a record is returned once its quotes are closed (null until then).
export function createRecordReader() {
  let pending = null;
  let quotes = 0;
  return {
    push(line) {
      pending = pending === null ? line : `${pending}\n${line}`;
      for (const c of line) if (c === '"') quotes++;
      if (quotes % 2 === 1) return null;
      const record = parseCsvLine(pending);
      pending = null;
      quotes = 0;
      return record;
    },
    // A last record left open at the end of the file (a broken file): reported, never loaded.
    leftover() {
      return pending;
    },
  };
}

// Header row and rows as objects, from the full text of a CSV (small files and tests); records may span lines.
export function parseCsvRecords(text) {
  const reader = createRecordReader();
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === "" && reader.leftover() === null) continue;
    const r = reader.push(line);
    if (r) records.push(r);
  }
  if (records.length === 0) return [];
  const [header, ...rest] = records;
  return rest.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}

// ---- barcodes ----
// The barcode as stored: digits only with the leading zeros removed (lib/food-barcode.ts normalizeBarcode), so UPC-A, EAN-13 and GTIN-14 forms of one product are one value. Null
// when there are no digits or more than 14 of them.
export function normalizeGtin(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d === "" || d.length > 14) return null;
  const stripped = d.replace(/^0+/, "");
  return stripped === "" ? null : stripped;
}

const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, max) => {
  const t = tidy(s);
  return t === "" ? null : t.slice(0, max);
};
const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 1000) / 1000 : null;
};
// The serving's unit as the app reads it: grams or millilitres (USDA writes g / GRM and ml / MLT); anything else is not a unit the app can weigh, so the serving is dropped.
export function servingUnit(raw) {
  const u = tidy(raw).toLowerCase();
  if (u === "g" || u === "grm" || u === "gram" || u === "grams") return "g";
  if (u === "ml" || u === "mlt" || u === "milliliter" || u === "millilitre" || u === "milliliters") return "ml";
  return null;
}

const dateOf = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? "")) ? String(v).slice(0, 10) : null);

// branded_food.csv rows -> Map fdc_id -> the label's facts (brand, barcode, serving).
export function buildBrandedIndex(brandedRows) {
  const out = new Map();
  for (const r of brandedRows) addBranded(out, r);
  return out;
}
export function addBranded(index, r) {
  const fdcId = Number(r.fdc_id);
  if (!Number.isInteger(fdcId) || fdcId <= 0) return;
  const unit = servingUnit(r.serving_size_unit);
  const size = positive(r.serving_size);
  index.set(fdcId, {
    gtin: normalizeGtin(r.gtin_upc),
    brand_owner: clip(r.brand_owner, 200),
    brand_name: clip(r.brand_name, 200),
    category: clip(r.branded_food_category, 120),
    serving_size: unit ? size : null,
    serving_size_unit: size ? unit : null,
    household_serving: clip(r.household_serving_fulltext, 120),
    modified: dateOf(r.modified_date) ?? dateOf(r.available_date),
  });
}

// A food.csv row of a branded product: its name and publication date, onto the label's facts. Returns false when it is not a branded product we have the label for.
export function addFoodRow(index, r) {
  if (r.data_type !== "branded_food") return false;
  const row = index.get(Number(r.fdc_id));
  if (!row) return false;
  row.description = clip(r.description, 300);
  row.published_date = dateOf(r.publication_date) ?? row.modified;
  return true;
}

// nutrient.csv rows -> Map nutrient id -> { key, rank } for the nutrients kept. A wrong unit is skipped with a warning.
export function buildBrandedNutrientIndex(nutrientRows, warn = () => {}) {
  const byNumber = new Map();
  for (const [key, def] of Object.entries(BRANDED_NUTRIENTS)) def.numbers.forEach((n, rank) => byNumber.set(n, { key, rank, unit: def.unit }));
  const index = new Map();
  for (const r of nutrientRows) {
    const hit = byNumber.get(String(r.nutrient_nbr).replace(/\.0+$/, ""));
    if (!hit) continue;
    if (String(r.unit_name).toUpperCase() !== hit.unit) {
      warn(`nutrient ${r.nutrient_nbr} (${r.name}) has unit ${r.unit_name}, expected ${hit.unit}: skipped`);
      continue;
    }
    index.set(String(r.id), { key: hit.key, rank: hit.rank });
  }
  return index;
}

// Streams food_nutrient.csv rows onto the products: for each product and nutrient the best-ranked source wins (energy 208 over an Atwater value).
export function addNutrientRow(index, nutrientIndex, r) {
  const row = index.get(Number(r.fdc_id));
  if (!row) return;
  const n = nutrientIndex.get(String(r.nutrient_id));
  if (!n) return;
  const amount = Number(r.amount);
  if (!Number.isFinite(amount) || amount < 0) return;
  row._rank ??= {};
  const had = row._rank[n.key];
  if (had === undefined || n.rank < had) {
    row._rank[n.key] = n.rank;
    row[n.key] = Math.round(amount * 1000) / 1000;
  }
}

// The rows to load: products with a name, kcal and at least one of protein, carbs and fat, every value inside the table's limits; one row per barcode (the most recently
// published, then the higher fdc_id). Returns the rows (sorted by fdc_id) and what was skipped and why.
export function finalizeBranded(index) {
  const skipped = { noName: 0, noKcal: 0, noMacros: 0, outOfRange: 0, olderDuplicate: 0 };
  const kept = [];
  for (const [fdcId, r] of index) {
    if (!r.description) {
      skipped.noName++;
      continue;
    }
    if (r.kcal === undefined) {
      skipped.noKcal++;
      continue;
    }
    if (r.protein_g === undefined && r.carbs_g === undefined && r.fat_g === undefined) {
      skipped.noMacros++;
      continue;
    }
    if (Object.entries(LIMITS).some(([k, max]) => r[k] !== undefined && (r[k] < 0 || r[k] > max))) {
      skipped.outOfRange++;
      continue;
    }
    kept.push({
      fdc_id: fdcId,
      gtin: r.gtin,
      brand_owner: r.brand_owner,
      brand_name: r.brand_name,
      description: r.description,
      category: r.category ?? null,
      serving_size: r.serving_size,
      serving_size_unit: r.serving_size_unit,
      household_serving: r.household_serving,
      kcal: r.kcal,
      protein_g: r.protein_g ?? null,
      carbs_g: r.carbs_g ?? null,
      fat_g: r.fat_g ?? null,
      fiber_g: r.fiber_g ?? null,
      sugars_g: r.sugars_g ?? null,
      sodium_mg: r.sodium_mg ?? null,
      published_date: r.published_date ?? null,
    });
  }
  const byGtin = new Map();
  const noGtin = [];
  for (const r of kept) {
    if (!r.gtin) {
      noGtin.push(r);
      continue;
    }
    const had = byGtin.get(r.gtin);
    if (!had) byGtin.set(r.gtin, r);
    else {
      skipped.olderDuplicate++;
      const newer = (r.published_date ?? "") > (had.published_date ?? "") || ((r.published_date ?? "") === (had.published_date ?? "") && r.fdc_id > had.fdc_id);
      if (newer) byGtin.set(r.gtin, r);
    }
  }
  const rows = [...noGtin, ...byGtin.values()].sort((a, b) => a.fdc_id - b.fdc_id);
  return { rows, skipped };
}

// ---- atomic, resumable batches ----
// One batch is ONE statement (a DO block): it loads completely or not at all, and records itself in public.usda_load_batches, so running it again does nothing. A later USDA release
// is loaded with a new batch name: each product is updated in place (on its fdc_id), and a product that USDA now publishes under a new fdc_id replaces the old row with the same
// barcode (one row per barcode).
export const BRANDED_BATCH_TAG = "$branded$";
const num = (v) => (v === null || v === undefined ? "null" : String(v));

export function toBrandedBatchSql(batchName, rows) {
  for (const t of [batchName, ...rows.flatMap((r) => [r.gtin, r.brand_owner, r.brand_name, r.description, r.category, r.serving_size_unit, r.household_serving, r.published_date])]) {
    if (t != null && String(t).includes(BRANDED_BATCH_TAG)) throw new Error(`refusing to write batch ${batchName}: the text "${String(t).slice(0, 60)}" contains ${BRANDED_BATCH_TAG}`);
  }
  const q = sqlText(batchName);
  const parts = [
    `-- USDA Branded Foods batch ${batchName}: ${rows.length} products. One statement: all of it or none of it. Safe to run again.`,
    "do $branded$",
    "begin",
    `  if exists (select 1 from public.usda_load_batches where name = ${q}) then`,
    "    return;",
    "  end if;",
  ];
  if (rows.length > 0) {
    const withGtin = rows.filter((r) => r.gtin);
    if (withGtin.length > 0) {
      parts.push(
        "  delete from public.usda_branded_foods b using (values\n" +
          withGtin.map(gtinLine).join(",\n") +
          "\n  ) as v(fdc_id, gtin) where b.gtin = v.gtin and b.fdc_id <> v.fdc_id;"
      );
    }
    parts.push(
      "  insert into public.usda_branded_foods (fdc_id, gtin, brand_owner, brand_name, description, category, serving_size, serving_size_unit, household_serving, kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sodium_mg, published_date) values\n" +
        rows.map(valuesLine).join(",\n") +
        "\n  on conflict (fdc_id) do update set gtin = excluded.gtin, brand_owner = excluded.brand_owner, brand_name = excluded.brand_name, description = excluded.description, category = excluded.category," +
        " serving_size = excluded.serving_size, serving_size_unit = excluded.serving_size_unit, household_serving = excluded.household_serving, kcal = excluded.kcal," +
        " protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, fiber_g = excluded.fiber_g, sugars_g = excluded.sugars_g," +
        " sodium_mg = excluded.sodium_mg, published_date = excluded.published_date;"
    );
  }
  parts.push(`  insert into public.usda_load_batches (name, rows_loaded) values (${q}, ${rows.length});`, "end", "$branded$;");
  return parts.join("\n") + "\n";
}

// One product's lines in a batch: its barcode in the replace step, and its values in the insert.
function gtinLine(r) {
  return `    (${r.fdc_id}, ${sqlText(r.gtin)})`;
}
function valuesLine(r) {
  return `    (${r.fdc_id}, ${sqlText(r.gtin)}, ${sqlText(r.brand_owner)}, ${sqlText(r.brand_name)}, ${sqlText(r.description)}, ${sqlText(r.category)}, ${num(r.serving_size)}, ${sqlText(r.serving_size_unit)}, ${sqlText(r.household_serving)}, ${num(r.kcal)}, ${num(r.protein_g)}, ${num(r.carbs_g)}, ${num(r.fat_g)}, ${num(r.fiber_g)}, ${num(r.sugars_g)}, ${num(r.sodium_mg)}, ${r.published_date ? `${sqlText(r.published_date)}::date` : "null"})`;
}

// Splits the rows into batches whose SQL stays under maxBytes (a batch must fit in one database call): each row's share is its own lines, in bytes, as they are written; the
// statement around them (comment, guard, the two statements' heads and the marker) is well under the fixed allowance.
export function planBrandedBatches(rows, maxBytes = 1_400_000) {
  const overhead = 4_000;
  const groups = [];
  let current = [];
  let size = overhead;
  for (const r of rows) {
    const one = Buffer.byteLength(valuesLine(r)) + 2 + (r.gtin ? Buffer.byteLength(gtinLine(r)) + 2 : 0);
    if (current.length > 0 && size + one > maxBytes) {
      groups.push(current);
      current = [];
      size = overhead;
    }
    current.push(r);
    size += one;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// ---- JSON batches, loaded through public.load_usda_branded_batch (migration 0468) ----
// The same products as a JSON body for one call: {"p_name": "...", "p_rows": [...]}. The function applies the same rules as a batch file, in one transaction, and records the same
// marker, so a batch loaded either way is never loaded twice.
const JSON_FIELDS = ["fdc_id", "gtin", "brand_owner", "brand_name", "description", "category", "serving_size", "serving_size_unit", "household_serving", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sodium_mg", "published_date"];
const jsonRow = (r) => JSON.stringify(Object.fromEntries(JSON_FIELDS.map((k) => [k, r[k] ?? null])));
export const JSON_ROWS_MAX = 10000;

export function toBrandedJsonBatch(batchName, rows) {
  if (!/^branded-[a-z0-9][a-z0-9-]{1,60}$/.test(batchName)) throw new Error(`batch name ${batchName} must start with branded-`);
  return `{"p_name":${JSON.stringify(batchName)},"p_rows":[\n${rows.map(jsonRow).join(",\n")}\n]}\n`;
}

// Splits the rows into JSON bodies under maxBytes and at most JSON_ROWS_MAX products each (the function's own limit).
export function planBrandedJsonBatches(rows, maxBytes = 1_400_000) {
  const overhead = 200;
  const groups = [];
  let current = [];
  let size = overhead;
  for (const r of rows) {
    const one = Buffer.byteLength(jsonRow(r)) + 2;
    if (current.length > 0 && (size + one > maxBytes || current.length >= JSON_ROWS_MAX)) {
      groups.push(current);
      current = [];
      size = overhead;
    }
    current.push(r);
    size += one;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// KEY=value lines of an env file (quotes around a value are removed; comments and blank lines skipped). Only what the loader asks for is used, and nothing is ever printed.
export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

// The batches still to load, in order: every file whose batch name has no marker yet.
export function pendingBatches(batches, loadedNames) {
  const loaded = new Set(loadedNames);
  return batches.filter((b) => !loaded.has(b.name));
}

// A call that ran past the database's statement time limit (Postgres code 57014): the loader says what to do in plain words.
export function isStatementTimeout(responseText) {
  return /57014|statement timeout|canceling statement due to statement timeout/i.test(String(responseText ?? ""));
}
export function timeoutHint(batchName) {
  return [
    `${batchName} ran past the database's time limit for one call (code 57014): its batch is too big for the table as it is now. Nothing of it was kept.`,
    "Write the batches again smaller, into a NEW folder and under a NEW --name (a new name loads everything again, which is safe: each product is updated in place),",
    "for example: node scripts/usda-branded-import.mjs <csv folder> --name branded-2026-10b --out <new folder> --json --max-bytes 150000",
    "then run this loader on the new folder. Do not reuse the old name with new batch sizes: the old markers would skip products that were never loaded.",
  ].join("\n");
}
