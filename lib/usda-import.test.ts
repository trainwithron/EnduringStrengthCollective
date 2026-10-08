import { describe, expect, it } from "vitest";
import * as lib from "../scripts/usda-lib.mjs";

const { parseCsvLine, parseCsv, buildFoods, buildNutrientIndex, createNutrientCollector, toSql, chunk, NUTRIENT_SOURCES } = lib as any;

describe("csv", () => {
  it("parses quotes, doubled quotes and commas inside quotes", () => {
    expect(parseCsvLine('1,"Chicken, breast, raw","a ""big"" one",')).toEqual(["1", "Chicken, breast, raw", 'a "big" one', ""]);
  });

  it("reads rows as objects", () => {
    const rows = parseCsv('id,description\r\n1,"Oats, rolled"\r\n2,Rice\r\n');
    expect(rows).toEqual([
      { id: "1", description: "Oats, rolled" },
      { id: "2", description: "Rice" },
    ]);
  });
});

describe("foods", () => {
  const foodRows = [
    { fdc_id: "100", data_type: "sr_legacy_food", description: " Beef, ground ", food_category_id: "13" },
    { fdc_id: "200", data_type: "foundation_food", description: "Spinach, raw", food_category_id: "" },
    { fdc_id: "300", data_type: "branded_food", description: "Some cereal", food_category_id: "" },
    { fdc_id: "bad", data_type: "sr_legacy_food", description: "x", food_category_id: "" },
    { fdc_id: "400", data_type: "sr_legacy_food", description: "Milk", food_category_id: "Dairy and Egg Products" },
  ];
  const foods = buildFoods(foodRows, [{ id: "13", description: "Beef Products" }]);

  it("keeps only Foundation and SR Legacy and names the type", () => {
    expect([...foods.keys()]).toEqual([100, 200, 400]);
    expect(foods.get(100)).toEqual({ fdc_id: 100, description: "Beef, ground", data_type: "SR Legacy", food_category: "Beef Products" });
    expect(foods.get(200).data_type).toBe("Foundation");
  });

  it("uses a text category as is and leaves a missing one empty", () => {
    expect(foods.get(400).food_category).toBe("Dairy and Egg Products");
    expect(foods.get(200).food_category).toBeNull();
  });
});

describe("nutrients", () => {
  const nutrientRows = [
    { id: "1008", name: "Energy", unit_name: "KCAL", nutrient_nbr: "208" },
    { id: "2048", name: "Energy (Atwater Specific)", unit_name: "KCAL", nutrient_nbr: "958" },
    { id: "1003", name: "Protein", unit_name: "G", nutrient_nbr: "203" },
    { id: "1114", name: "Vitamin D (D2 + D3)", unit_name: "UG", nutrient_nbr: "328" },
    { id: "1110", name: "Vitamin D (IU)", unit_name: "IU", nutrient_nbr: "324" },
    { id: "1095", name: "Zinc", unit_name: "MG", nutrient_nbr: "309" },
    { id: "9999", name: "Wrong unit", unit_name: "G", nutrient_nbr: "307" },
  ];

  it("indexes the nutrients the app uses and warns about a wrong unit", () => {
    const warnings: string[] = [];
    const index = buildNutrientIndex(nutrientRows, (m: string) => warnings.push(m));
    expect(index.get("1003").key).toBe("protein_g");
    expect(index.get("1114").key).toBe("vitamin_d_mcg");
    expect(index.has("1110")).toBe(false); // IU vitamin D is not used
    expect(index.has("9999")).toBe(false);
    expect(warnings.some((w) => w.includes("sodium") === false && w.includes("307"))).toBe(true);
  });

  it("covers every key the app reads", () => {
    const keys = Object.keys(NUTRIENT_SOURCES);
    for (const k of ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg", "vitamin_d_mcg", "magnesium_mg", "zinc_mg", "b12_mcg", "vitamin_c_mg", "folate_mcg", "sat_fat_g"]) {
      expect(keys).toContain(k);
    }
  });

  it("prefers regular energy over an Atwater value, but falls back to Atwater when it is all there is", () => {
    const index = buildNutrientIndex(nutrientRows);
    const foods = new Map([[1, {}], [2, {}]]);
    const c = createNutrientCollector(foods, index);
    c.add({ fdc_id: "1", nutrient_id: "2048", amount: "170" });
    c.add({ fdc_id: "1", nutrient_id: "1008", amount: "165" });
    c.add({ fdc_id: "2", nutrient_id: "2048", amount: "23" });
    const rows = c.rows();
    expect(rows.find((r: any) => r.fdc_id === 1 && r.nutrient_key === "kcal").amount_per_100g).toBe(165);
    expect(rows.find((r: any) => r.fdc_id === 2 && r.nutrient_key === "kcal").amount_per_100g).toBe(23);
  });

  it("ignores foods not kept, unknown nutrients and bad amounts", () => {
    const index = buildNutrientIndex(nutrientRows);
    const c = createNutrientCollector(new Map([[1, {}]]), index);
    c.add({ fdc_id: "5", nutrient_id: "1003", amount: "10" });
    c.add({ fdc_id: "1", nutrient_id: "0000", amount: "10" });
    c.add({ fdc_id: "1", nutrient_id: "1003", amount: "abc" });
    c.add({ fdc_id: "1", nutrient_id: "1003", amount: "-2" });
    expect(c.rows()).toEqual([]);
  });
});

describe("sql", () => {
  it("writes upserts and escapes quotes", () => {
    const foods = new Map([[7, { fdc_id: 7, description: "Cook's \"best\" rice", data_type: "SR Legacy", food_category: null }]]);
    const sql = toSql(foods, [{ fdc_id: 7, nutrient_key: "protein_g", amount_per_100g: 2.7 }]);
    expect(sql).toContain("(7, 'Cook''s \"best\" rice', 'SR Legacy', null)");
    expect(sql).toContain("on conflict (fdc_id) do update");
    expect(sql).toContain("(7, 'protein_g', 2.7)");
    expect(sql).toContain("on conflict (fdc_id, nutrient_key) do update");
  });

  it("splits lists into chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("the fuller nutrient panel", () => {
  const rows = [
    { id: "1", name: "Folate, DFE", unit_name: "UG", nutrient_nbr: "435" },
    { id: "2", name: "Folate, total", unit_name: "UG", nutrient_nbr: "417" },
    { id: "3", name: "Copper, Cu", unit_name: "MG", nutrient_nbr: "312" },
    { id: "4", name: "Vitamin A, RAE", unit_name: "UG", nutrient_nbr: "320" },
    { id: "5", name: "Selenium, Se", unit_name: "UG", nutrient_nbr: "317" },
    { id: "6", name: "Thiamin", unit_name: "MG", nutrient_nbr: "404" },
  ];
  it("covers every key the nutrient screens show", () => {
    const keys = Object.keys(NUTRIENT_SOURCES);
    for (const k of ["vitamin_a_mcg", "vitamin_e_mg", "vitamin_k_mcg", "thiamin_mg", "riboflavin_mg", "niacin_mg", "b6_mg", "choline_mg", "phosphorus_mg", "copper_mcg", "manganese_mg", "selenium_mcg", "iodine_mcg"]) expect(keys).toContain(k);
  });
  it("prefers folate in DFE (the unit the reference intake is set in) and falls back to total folate", () => {
    const index = buildNutrientIndex(rows);
    const c = createNutrientCollector(new Map([[1, {}], [2, {}]]), index);
    c.add({ fdc_id: "1", nutrient_id: "2", amount: "100" });
    c.add({ fdc_id: "1", nutrient_id: "1", amount: "170" });
    c.add({ fdc_id: "2", nutrient_id: "2", amount: "60" });
    const out = c.rows();
    expect(out.find((r: any) => r.fdc_id === 1 && r.nutrient_key === "folate_mcg").amount_per_100g).toBe(170);
    expect(out.find((r: any) => r.fdc_id === 2 && r.nutrient_key === "folate_mcg").amount_per_100g).toBe(60);
  });
  it("converts copper from mg to mcg", () => {
    const c = createNutrientCollector(new Map([[1, {}]]), buildNutrientIndex(rows));
    c.add({ fdc_id: "1", nutrient_id: "3", amount: "0.25" });
    expect(c.rows().find((r: any) => r.nutrient_key === "copper_mcg").amount_per_100g).toBe(250);
  });
  it("a food USDA does not report a nutrient for simply has no row (never a zero)", () => {
    const c = createNutrientCollector(new Map([[1, {}]]), buildNutrientIndex(rows));
    c.add({ fdc_id: "1", nutrient_id: "4", amount: "500" });
    expect(c.rows().map((r: any) => r.nutrient_key)).toEqual(["vitamin_a_mcg"]);
  });
});

describe("household portions", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const batch = require("../scripts/usda-batch-lib.mjs");
  const foods = new Map([[10, { fdc_id: 10, description: "Onions, raw", data_type: "SR Legacy", food_category: null }]]);
  const units = [
    { id: "1", name: "cup" },
    { id: "9", name: "undetermined" },
  ];
  it("reads like people say it: amount, unit and modifier, or USDA's own words", () => {
    const rows = batch.buildPortions(
      [
        { fdc_id: "10", seq_num: "1", amount: "1.0", measure_unit_id: "1", modifier: "chopped", portion_description: "", gram_weight: "160" },
        { fdc_id: "10", seq_num: "2", amount: "1", measure_unit_id: "9", modifier: "medium (2-1/2\" dia)", portion_description: "", gram_weight: "110" },
        { fdc_id: "10", seq_num: "3", amount: "1", measure_unit_id: "9", modifier: "", portion_description: "1 slice", gram_weight: "28.35" },
        { fdc_id: "10", seq_num: "4", amount: "2", measure_unit_id: "1", modifier: "", portion_description: "", gram_weight: "320" },
      ],
      units,
      foods
    );
    expect(rows.map((r: any) => r.description)).toEqual(["1 cup, chopped", '1 medium (2-1/2" dia)', "1 slice", "2 cup"]);
    expect(rows[2].gram_weight).toBe(28.35);
  });
  it("drops foods not kept, unusable weights and rows with no words, and fixes repeated or missing sequence numbers", () => {
    const rows = batch.buildPortions(
      [
        { fdc_id: "99", seq_num: "1", amount: "1", measure_unit_id: "1", modifier: "", portion_description: "", gram_weight: "100" },
        { fdc_id: "10", seq_num: "1", amount: "1", measure_unit_id: "1", modifier: "", portion_description: "", gram_weight: "0" },
        { fdc_id: "10", seq_num: "1", amount: "1", measure_unit_id: "9", modifier: "", portion_description: "", gram_weight: "50" },
        { fdc_id: "10", seq_num: "1", amount: "1", measure_unit_id: "1", modifier: "", portion_description: "", gram_weight: "240" },
        { fdc_id: "10", seq_num: "", amount: "0.5", measure_unit_id: "1", modifier: "", portion_description: "", gram_weight: "120" },
        { fdc_id: "10", seq_num: "1", amount: "1", measure_unit_id: "1", modifier: "sliced", portion_description: "", gram_weight: "100000" },
      ],
      units,
      foods
    );
    expect(rows).toEqual([
      { fdc_id: 10, seq: 1, description: "1 cup", gram_weight: 240 },
      { fdc_id: 10, seq: 2, description: "0.5 cup", gram_weight: 120 },
    ]);
  });
});

describe("batches are atomic and resumable", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toBatchSql } = require("../scripts/usda-batch-lib.mjs");
  const foods = new Map([[7, { fdc_id: 7, description: "Cook's rice", data_type: "SR Legacy", food_category: null }]]);
  const sql = toBatchSql("fdc-2026-04-001", foods, [{ fdc_id: 7, nutrient_key: "protein_g", amount_per_100g: 2.7 }], [{ fdc_id: 7, seq: 1, description: "1 cup", gram_weight: 158 }]);
  it("is one statement that does nothing if its marker exists, and writes its marker last", () => {
    expect(sql.match(/do \$load\$/g)).toHaveLength(1);
    expect(sql).toContain("if exists (select 1 from public.usda_load_batches where name = 'fdc-2026-04-001') then");
    expect(sql.indexOf("return;")).toBeLessThan(sql.indexOf("insert into public.usda_foods"));
    expect(sql.indexOf("insert into public.usda_load_batches")).toBeGreaterThan(sql.indexOf("insert into public.usda_food_portions"));
    expect(sql.trim().endsWith("$load$;")).toBe(true);
  });
  it("upserts foods, nutrients and portions and counts the rows in the marker", () => {
    expect(sql).toContain("(7, 'Cook''s rice', 'SR Legacy', null)");
    expect(sql).toContain("on conflict (fdc_id, nutrient_key) do update");
    expect(sql).toContain("on conflict (fdc_id, seq) do update");
    expect(sql).toContain("values ('fdc-2026-04-001', 3)");
  });
});
