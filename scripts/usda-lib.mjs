// The pure parts of the USDA FoodData Central import (scripts/usda-import.mjs): reading the CSV files USDA publishes and turning
// them into rows for public.usda_foods and public.usda_food_nutrients. No network, no database, so it can be tested.
//
// Source: https://fdc.nal.usda.gov/download-datasets.html (Foundation Foods and SR Legacy, CSV). The files used are
// food.csv, food_category.csv, nutrient.csv and food_nutrient.csv. Assumes no line breaks inside a quoted field, which holds
// for these files.

// App nutrient key -> USDA nutrient numbers, best source first (the first one a food has is used), and the unit expected.
// kcal: 208 is the usual energy value; Foundation foods often carry only the Atwater values (958 specific, 957 general).
export const NUTRIENT_SOURCES = {
  kcal: { numbers: ["208", "958", "957"], unit: "KCAL" },
  protein_g: { numbers: ["203"], unit: "G" },
  carbs_g: { numbers: ["205"], unit: "G" },
  fat_g: { numbers: ["204"], unit: "G" },
  fiber_g: { numbers: ["291"], unit: "G" },
  sodium_mg: { numbers: ["307"], unit: "MG" },
  potassium_mg: { numbers: ["306"], unit: "MG" },
  calcium_mg: { numbers: ["301"], unit: "MG" },
  iron_mg: { numbers: ["303"], unit: "MG" },
  vitamin_d_mcg: { numbers: ["328"], unit: "UG" },
  magnesium_mg: { numbers: ["304"], unit: "MG" },
  zinc_mg: { numbers: ["309"], unit: "MG" },
  b12_mcg: { numbers: ["418"], unit: "UG" },
  vitamin_c_mg: { numbers: ["401"], unit: "MG" },
  folate_mcg: { numbers: ["417"], unit: "UG" },
  sat_fat_g: { numbers: ["606"], unit: "G" },
};

export const DATA_TYPES = { foundation_food: "Foundation", sr_legacy_food: "SR Legacy" };

// One CSV line to its fields. Handles quotes, doubled quotes and commas inside quotes.
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// Header row and rows as objects, from the full text of a small CSV file.
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

// Foods to keep: Foundation and SR Legacy only. Returns Map fdc_id -> { fdc_id, description, data_type, food_category }.
export function buildFoods(foodRows, categoryRows) {
  const categories = new Map(categoryRows.map((c) => [c.id, c.description]));
  const foods = new Map();
  for (const r of foodRows) {
    const type = DATA_TYPES[r.data_type];
    if (!type) continue;
    const fdcId = Number(r.fdc_id);
    if (!Number.isInteger(fdcId) || !r.description) continue;
    const rawCategory = r.food_category_id ?? "";
    const category = categories.get(rawCategory) ?? (rawCategory && Number.isNaN(Number(rawCategory)) ? rawCategory : null);
    foods.set(fdcId, { fdc_id: fdcId, description: r.description.trim(), data_type: type, food_category: category });
  }
  return foods;
}

// nutrient.csv rows -> Map nutrient_id -> { key, rank } for the nutrients the app uses. Warns about an unexpected unit.
export function buildNutrientIndex(nutrientRows, warn = () => {}) {
  const byNumber = new Map();
  for (const [key, def] of Object.entries(NUTRIENT_SOURCES)) {
    def.numbers.forEach((n, rank) => byNumber.set(n, { key, rank, unit: def.unit }));
  }
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

// Accumulates food_nutrient rows one at a time (the file is large and is streamed). For each food and key the best-ranked source
// wins, so a food with energy 208 never uses an Atwater value.
export function createNutrientCollector(foods, nutrientIndex) {
  const best = new Map(); // `${fdc}|${key}` -> { rank, amount }
  return {
    add(row) {
      const fdcId = Number(row.fdc_id);
      if (!foods.has(fdcId)) return;
      const n = nutrientIndex.get(String(row.nutrient_id));
      if (!n) return;
      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount < 0) return;
      const k = `${fdcId}|${n.key}`;
      const cur = best.get(k);
      if (!cur || n.rank < cur.rank) best.set(k, { rank: n.rank, amount });
    },
    rows() {
      const out = [];
      for (const [k, v] of best) {
        const [fdc, key] = k.split("|");
        out.push({ fdc_id: Number(fdc), nutrient_key: key, amount_per_100g: Math.round(v.amount * 1000) / 1000 });
      }
      return out.sort((a, b) => a.fdc_id - b.fdc_id || a.nutrient_key.localeCompare(b.nutrient_key));
    },
  };
}

function sqlText(s) {
  return s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`;
}

// SQL that adds or refreshes the given foods and nutrients. Safe to run twice: it upserts on the primary and unique keys.
export function toSql(foods, nutrientRows) {
  const foodList = [...foods.values()].sort((a, b) => a.fdc_id - b.fdc_id);
  const parts = [];
  parts.push("-- Generated by scripts/usda-import.mjs. Upserts, so it can be run more than once.");
  if (foodList.length > 0) {
    parts.push(
      "insert into public.usda_foods (fdc_id, description, data_type, food_category) values\n" +
        foodList.map((f) => `  (${f.fdc_id}, ${sqlText(f.description)}, ${sqlText(f.data_type)}, ${sqlText(f.food_category)})`).join(",\n") +
        "\non conflict (fdc_id) do update set description = excluded.description, data_type = excluded.data_type, food_category = excluded.food_category;"
    );
  }
  if (nutrientRows.length > 0) {
    parts.push(
      "insert into public.usda_food_nutrients (fdc_id, nutrient_key, amount_per_100g) values\n" +
        nutrientRows.map((n) => `  (${n.fdc_id}, ${sqlText(n.nutrient_key)}, ${n.amount_per_100g})`).join(",\n") +
        "\non conflict (fdc_id, nutrient_key) do update set amount_per_100g = excluded.amount_per_100g;"
    );
  }
  return parts.join("\n\n") + "\n";
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
