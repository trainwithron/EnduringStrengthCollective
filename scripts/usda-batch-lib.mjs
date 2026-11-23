// The pure parts of loading USDA household portions and writing the load as atomic, resumable batches, plus the BEFORE / AFTER report. No network, no database, so it can be tested.
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
    // FNDDS lists "Quantity not specified" (the amount people report when they give none): it is not a serving anyone picks, and as the first portion it would be the default
    if (/^quantity not specified$/i.test(description.trim())) continue;
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
//
// Two modes. "add" (the default) only ADDS: a food, nutrient value or portion that is already in the database is left exactly as it is, so the 8,000-odd foods the app, the saved
// plans and people's logs already rely on cannot shift. Keys listed in refreshKeys (for example folate_mcg, which moves from total folate to DFE) are the one exception: those values
// are updated. "refresh" updates everything that is already there.
export const BATCH_TAG = "$load$";

export function toBatchSql(batchName, foods, nutrientRows, portionRows, opts = {}) {
  const mode = opts.mode === "refresh" ? "refresh" : "add";
  const refreshKeys = new Set(opts.refreshKeys ?? []);
  const foodList = [...foods.values()].sort((a, b) => a.fdc_id - b.fdc_id);
  // The statement is wrapped in a dollar-quote tag; refuse any text that contains the tag (it would end the statement early and the rest would run outside the batch).
  const texts = [batchName, ...foodList.flatMap((f) => [f.description, f.data_type, f.food_category, f.plain_name, f.extra_names]), ...portionRows.map((p) => p.description), ...nutrientRows.map((n) => n.nutrient_key)];
  for (const t of texts) {
    if (t != null && String(t).includes(BATCH_TAG)) throw new Error(`refusing to write batch ${batchName}: the text "${String(t).slice(0, 60)}" contains ${BATCH_TAG}`);
  }
  const q = sqlText(batchName);
  const parts = [
    `-- USDA batch ${batchName} (${mode} mode): ${foodList.length} foods, ${nutrientRows.length} nutrient rows, ${portionRows.length} portions. One statement: all of it or none of it. Safe to run again.`,
    "do $load$",
    "begin",
    `  if exists (select 1 from public.usda_load_batches where name = ${q}) then`,
    "    return;",
    "  end if;",
  ];
  if (foodList.length > 0) {
    // plain_name, extra_names and common (step 223) are written only by a batch that holds everyday (FNDDS) foods, so a Foundation / SR Legacy batch reads exactly as before (and runs
    // on a database without step 223).
    const everyday = foodList.some((f) => f.data_type === "Survey (FNDDS)");
    const rows = foodList
      .map((f) =>
        everyday
          ? `    (${f.fdc_id}, ${sqlText(f.description)}, ${sqlText(f.data_type)}, ${sqlText(f.food_category)}, ${sqlText(f.plain_name ?? null)}, ${sqlText(f.extra_names ?? null)}, ${f.common === true})`
          : `    (${f.fdc_id}, ${sqlText(f.description)}, ${sqlText(f.data_type)}, ${sqlText(f.food_category)})`
      )
      .join(",\n");
    const tail =
      mode === "refresh"
        ? "\n  on conflict (fdc_id) do update set description = excluded.description, data_type = excluded.data_type, food_category = excluded.food_category" +
          (everyday ? ", plain_name = excluded.plain_name, extra_names = excluded.extra_names, common = excluded.common;" : ";")
        : "\n  on conflict (fdc_id) do nothing;";
    const columns = everyday ? "fdc_id, description, data_type, food_category, plain_name, extra_names, common" : "fdc_id, description, data_type, food_category";
    parts.push(`  insert into public.usda_foods (${columns}) values\n` + rows + tail);
  }
  const nutrientInsert = (rows, update) =>
    "  insert into public.usda_food_nutrients (fdc_id, nutrient_key, amount_per_100g) values\n" +
    rows.map((n) => `    (${n.fdc_id}, ${sqlText(n.nutrient_key)}, ${n.amount_per_100g})`).join(",\n") +
    (update ? "\n  on conflict (fdc_id, nutrient_key) do update set amount_per_100g = excluded.amount_per_100g;" : "\n  on conflict (fdc_id, nutrient_key) do nothing;");
  const updates = (n) => mode === "refresh" || refreshKeys.has(n.nutrient_key);
  const refreshed = nutrientRows.filter(updates);
  const addOnly = nutrientRows.filter((n) => !updates(n));
  if (addOnly.length > 0) parts.push(nutrientInsert(addOnly, false));
  if (refreshed.length > 0) parts.push(nutrientInsert(refreshed, true));
  if (portionRows.length > 0) {
    const rows = portionRows.map((p) => `    (${p.fdc_id}, ${p.seq}, ${sqlText(p.description)}, ${p.gram_weight})`).join(",\n");
    const tail =
      mode === "refresh"
        ? "\n  on conflict (fdc_id, seq) do update set description = excluded.description, gram_weight = excluded.gram_weight;"
        : "\n  on conflict (fdc_id, seq) do nothing;";
    parts.push("  insert into public.usda_food_portions (fdc_id, seq, description, gram_weight) values\n" + rows + tail);
  }
  parts.push(`  insert into public.usda_load_batches (name, rows_loaded) values (${q}, ${foodList.length + nutrientRows.length + portionRows.length});`, "end", "$load$;");
  return parts.join("\n") + "\n";
}

// ---- the BEFORE / AFTER report ----
// Compares what the import would write with what is in the database now, so a person can read it before any batch is run: how many foods, nutrient values and portions are new,
// how many already there would change (and which keys), which keys are new to the database, and the biggest changes to the four macros (the numbers the food table, saved plans
// and logged food depend on). `existing` = { foods: Map fdc_id -> {description, data_type, food_category}, nutrients: Map "fdc_id|key" -> amount, portions: Set "fdc_id|seq" }.
const SAME = 0.001;
const MACROS = ["kcal", "protein_g", "carbs_g", "fat_g"];

export function compareWithExisting(foods, nutrientRows, portionRows, existing) {
  const r = {
    foods: { total: foods.size, new: 0, existing: 0, descriptionChanged: 0, examples: [] },
    nutrients: { total: nutrientRows.length, new: 0, same: 0, changed: 0, byKey: {}, newKeys: [] },
    portions: { total: portionRows.length, new: 0, existing: 0 },
    largestMacroChanges: [],
  };
  for (const f of foods.values()) {
    const e = existing.foods.get(f.fdc_id);
    if (!e) r.foods.new += 1;
    else {
      r.foods.existing += 1;
      if (e.description !== f.description) {
        r.foods.descriptionChanged += 1;
        if (r.foods.examples.length < 10) r.foods.examples.push({ fdc_id: f.fdc_id, before: e.description, after: f.description });
      }
    }
  }
  const existingKeys = new Set([...existing.nutrients.keys()].map((k) => k.split("|")[1]));
  const keyRow = (key) => (r.nutrients.byKey[key] ??= { new: 0, same: 0, changed: 0 });
  const macroChanges = [];
  for (const n of nutrientRows) {
    const before = existing.nutrients.get(`${n.fdc_id}|${n.nutrient_key}`);
    const row = keyRow(n.nutrient_key);
    if (before === undefined) {
      r.nutrients.new += 1;
      row.new += 1;
    } else if (Math.abs(before - n.amount_per_100g) <= SAME) {
      r.nutrients.same += 1;
      row.same += 1;
    } else {
      r.nutrients.changed += 1;
      row.changed += 1;
      if (MACROS.includes(n.nutrient_key)) {
        macroChanges.push({ fdc_id: n.fdc_id, key: n.nutrient_key, before, after: n.amount_per_100g, relPct: before === 0 ? 100 : Math.round((Math.abs(n.amount_per_100g - before) / Math.abs(before)) * 1000) / 10 });
      }
    }
  }
  r.nutrients.newKeys = Object.keys(r.nutrients.byKey).filter((k) => !existingKeys.has(k)).sort();
  for (const p of portionRows) {
    if (existing.portions.has(`${p.fdc_id}|${p.seq}`)) r.portions.existing += 1;
    else r.portions.new += 1;
  }
  r.largestMacroChanges = macroChanges
    .sort((a, b) => b.relPct - a.relPct)
    .slice(0, 15)
    .map((c) => ({ ...c, description: foods.get(c.fdc_id)?.description ?? "" }));
  return r;
}

export function formatReport(report, mode, refreshKeys = []) {
  const n = report.nutrients;
  const willChange = mode === "refresh" ? n.changed : Object.entries(n.byKey).filter(([k]) => refreshKeys.includes(k)).reduce((s, [, v]) => s + v.changed, 0);
  const modeText = mode === "add" ? `only adds; values already in the database are left alone${refreshKeys.length ? `, except these keys, which ARE updated: ${refreshKeys.join(", ")}` : ""}` : "updates everything already there";
  const lines = [
    "# USDA import: before / after report",
    "",
    `Mode: **${mode}** (${modeText}).`,
    "",
    "## Foods",
    `- In the files: ${report.foods.total}. Already in the database: ${report.foods.existing}. New: ${report.foods.new}.`,
    `- Existing foods whose description differs: ${report.foods.descriptionChanged}${mode === "add" ? " (NOT changed in add mode)" : ""}.`,
    ...report.foods.examples.map((e) => `  - ${e.fdc_id}: "${e.before}" -> "${e.after}"`),
    "",
    "## Nutrient values",
    `- In the files: ${n.total}. New values: ${n.new}. Already there and the same: ${n.same}. Already there and DIFFERENT: ${n.changed}.`,
    `- Different values that WOULD be rewritten in this mode: **${willChange}**.`,
    `- Keys that are new to the database: ${n.newKeys.length ? n.newKeys.join(", ") : "none"}.`,
    ...(n.byKey.niacin_mg && n.byKey.niacin_mg.changed > 0 && !refreshKeys.includes("niacin_mg") && mode === "add"
      ? [`- **WARNING: ${n.byKey.niacin_mg.changed} foods already have a niacin_mg value that differs.** Niacin is imported as niacin EQUIVALENTS; in add mode those older values stay as they are, so the table would mix two meanings. Add niacin_mg to --refresh-keys.`]
      : []),
    "",
    "| key | new | same | different |",
    "|---|---|---|---|",
    ...Object.entries(n.byKey)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `| ${k} | ${v.new} | ${v.same} | ${v.changed} |`),
    "",
    "## Biggest changes to the four macros in foods already there (not applied in add mode)",
    ...(report.largestMacroChanges.length
      ? ["| food | key | before | after | change |", "|---|---|---|---|---|", ...report.largestMacroChanges.map((c) => `| ${c.fdc_id} ${c.description} | ${c.key} | ${c.before} | ${c.after} | ${c.relPct}% |`)]
      : ["None."]),
    "",
    "## Household portions",
    `- In the files: ${report.portions.total}. New: ${report.portions.new}. Already there: ${report.portions.existing}.`,
    "",
  ];
  return lines.join("\n");
}

// ---- the same batch as JSON, for the loader (step 223: public.load_usda_food_batch, sent by scripts/usda-food-load.mjs with the server key) ----
// The function applies exactly what toBatchSql writes (the same add / refresh rules), all of it or none of it, and skips a batch whose marker is already there. A JSON batch must stay
// under MAX_JSON_BATCH_BYTES (an API request body has a size limit).
export const MAX_JSON_BATCH_BYTES = 1_400_000;

export function toBatchJson(batchName, foods, nutrientRows, portionRows, opts = {}) {
  const mode = opts.mode === "refresh" ? "refresh" : "add";
  const body = {
    p_name: batchName,
    p_mode: mode,
    p_refresh_keys: [...(opts.refreshKeys ?? [])],
    p_foods: [...foods.values()]
      .sort((a, b) => a.fdc_id - b.fdc_id)
      .map((f) => ({ fdc_id: f.fdc_id, description: f.description, data_type: f.data_type, food_category: f.food_category ?? null, plain_name: f.plain_name ?? null, extra_names: f.extra_names ?? null, common: f.common === true })),
    p_nutrients: nutrientRows.map((n) => ({ fdc_id: n.fdc_id, nutrient_key: n.nutrient_key, amount_per_100g: n.amount_per_100g })),
    p_portions: portionRows.map((p) => ({ fdc_id: p.fdc_id, seq: p.seq, description: p.description, gram_weight: p.gram_weight })),
  };
  const text = JSON.stringify(body);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_JSON_BATCH_BYTES) throw new Error(`batch ${batchName} is ${bytes} bytes as JSON, over ${MAX_JSON_BATCH_BYTES}: use a smaller --batch-size`);
  return text;
}
