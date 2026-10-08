// The pure parts of loading USDA household portions and writing the load as atomic, resumable batches. No network, no database, so it can be tested.
// Used by scripts/usda-import.mjs together with scripts/usda-lib.mjs.
import { sqlText } from "./usda-lib.mjs";

// ---- household portions ("1 cup, chopped" = 140 g) ----
// food_portion.csv: id, fdc_id, seq_num, amount, measure_unit_id, portion_description, modifier, gram_weight, ... ; measure_unit.csv: id, name, abbreviation.
// A portion reads as people say it: USDA's own description when it has one, else the amount and the unit and the modifier ("1 cup, chopped"). The gram weight is for the whole
// description (2 slices = 56 g). Portions with no usable weight or no words are dropped.
const cleanAmount = (a) => {
  const n = Number(a);
  if (!Number.isFinite(n) || n <= 0) return "1";
  return String(Math.round(n * 1000) / 1000);
};

export function describePortion(row, unitNames) {
  const own = String(row.portion_description ?? "").trim();
  if (own) return own;
  const unit = String(unitNames.get(String(row.measure_unit_id)) ?? "").trim();
  const modifier = String(row.modifier ?? "").trim();
  const amount = cleanAmount(row.amount);
  const hasUnit = unit !== "" && unit.toLowerCase() !== "undetermined";
  if (hasUnit) return modifier ? `${amount} ${unit}, ${modifier}` : `${amount} ${unit}`;
  return modifier ? `${amount} ${modifier}` : "";
}

// Rows for public.usda_food_portions: { fdc_id, seq, description, gram_weight }, for the foods kept, one per (food, seq).
export function buildPortions(portionRows, measureUnitRows, foods) {
  const unitNames = new Map(measureUnitRows.map((u) => [String(u.id), u.name]));
  const byFood = new Map();
  for (const r of portionRows) {
    const fdcId = Number(r.fdc_id);
    if (!foods.has(fdcId)) continue;
    const grams = Number(r.gram_weight);
    if (!Number.isFinite(grams) || grams <= 0 || grams >= 100000) continue;
    const description = describePortion(r, unitNames).slice(0, 200);
    if (!description) continue;
    const seqNum = r.seq_num === "" || r.seq_num == null ? NaN : Number(r.seq_num);
    const list = byFood.get(fdcId) ?? [];
    list.push({ seq: Number.isInteger(seqNum) && seqNum > 0 ? seqNum : null, description, gram_weight: Math.round(grams * 100) / 100 });
    byFood.set(fdcId, list);
  }
  const rows = [];
  for (const [fdcId, list] of byFood) {
    // a missing or repeated sequence number gets the next free one, so (food, seq) stays unique
    const used = new Set();
    let next = 1;
    for (const p of list) {
      let seq = p.seq != null && !used.has(p.seq) ? p.seq : null;
      if (seq == null) {
        while (used.has(next)) next++;
        seq = next;
      }
      used.add(seq);
      rows.push({ fdc_id: fdcId, seq, description: p.description, gram_weight: p.gram_weight });
    }
  }
  return rows.sort((a, b) => a.fdc_id - b.fdc_id || a.seq - b.seq);
}

// ---- atomic, resumable batches ----
// One batch is ONE statement (a DO block), so it loads completely or not at all, and it ends by writing a marker row in public.usda_load_batches. Running a batch whose marker
// exists does nothing, so an interrupted load can simply be run again from the start: finished batches are skipped and the rest load. A half-loaded batch cannot exist.
export function toBatchSql(batchName, foods, nutrientRows, portionRows) {
  const foodList = [...foods.values()].sort((a, b) => a.fdc_id - b.fdc_id);
  const q = sqlText(batchName);
  const parts = [
    `-- USDA batch ${batchName}: ${foodList.length} foods, ${nutrientRows.length} nutrient rows, ${portionRows.length} portions. One statement: all of it or none of it. Safe to run again.`,
    "do $load$",
    "begin",
    `  if exists (select 1 from public.usda_load_batches where name = ${q}) then`,
    "    return;",
    "  end if;",
  ];
  if (foodList.length > 0) {
    parts.push(
      "  insert into public.usda_foods (fdc_id, description, data_type, food_category) values\n" +
        foodList.map((f) => `    (${f.fdc_id}, ${sqlText(f.description)}, ${sqlText(f.data_type)}, ${sqlText(f.food_category)})`).join(",\n") +
        "\n  on conflict (fdc_id) do update set description = excluded.description, data_type = excluded.data_type, food_category = excluded.food_category;"
    );
  }
  if (nutrientRows.length > 0) {
    parts.push(
      "  insert into public.usda_food_nutrients (fdc_id, nutrient_key, amount_per_100g) values\n" +
        nutrientRows.map((n) => `    (${n.fdc_id}, ${sqlText(n.nutrient_key)}, ${n.amount_per_100g})`).join(",\n") +
        "\n  on conflict (fdc_id, nutrient_key) do update set amount_per_100g = excluded.amount_per_100g;"
    );
  }
  if (portionRows.length > 0) {
    parts.push(
      "  insert into public.usda_food_portions (fdc_id, seq, description, gram_weight) values\n" +
        portionRows.map((p) => `    (${p.fdc_id}, ${p.seq}, ${sqlText(p.description)}, ${p.gram_weight})`).join(",\n") +
        "\n  on conflict (fdc_id, seq) do update set description = excluded.description, gram_weight = excluded.gram_weight;"
    );
  }
  parts.push(`  insert into public.usda_load_batches (name, rows_loaded) values (${q}, ${foodList.length + nutrientRows.length + portionRows.length});`, "end", "$load$;");
  return parts.join("\n") + "\n";
}
