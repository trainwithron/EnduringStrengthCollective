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
