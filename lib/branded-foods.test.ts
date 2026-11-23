import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { barcodeCandidates, brandedBarcodeResult, brandedHitFromRow, expandUpcE, lookupBrandedBarcode, searchBranded, type BrandedRow } from "./branded-foods";
import { lookupBarcodeInOrder, NOT_FOUND, UNREACHABLE } from "./barcode-lookup";
import { normalizeBarcode } from "./food-barcode";
// the importer's pure parts (scripts/usda-branded-lib.mjs)
import {
  addBranded,
  addFoodRow,
  addNutrientRow,
  buildBrandedNutrientIndex,
  finalizeBranded,
  normalizeGtin,
  parseCsvRecords,
  planBrandedBatches,
  servingUnit,
  toBrandedBatchSql,
} from "../scripts/usda-branded-lib.mjs";

// Ron, Nov 23: the food search rebuild, part B (USDA Branded Foods for the barcode and the "Packaged foods" group). The database side is rehearsed in
// scripts/sql-tests/usda-branded.test.mjs (step 224).

const row = (over: Partial<BrandedRow> = {}): BrandedRow => ({
  fdc_id: 1000001,
  gtin: "16000275287",
  brand_owner: "General Mills Sales Inc.",
  brand_name: "Cheerios",
  description: "CHEERIOS TOASTED WHOLE GRAIN OAT CEREAL",
  category: "Cereal",
  serving_size: 28,
  serving_size_unit: "g",
  household_serving: "1 cup",
  kcal: 357,
  protein_g: 10.7,
  carbs_g: 73.2,
  fat_g: 7.14,
  fiber_g: null,
  sugars_g: "3.57",
  sodium_mg: 500,
  ...over,
});

describe("barcodes", () => {
  it("UPC-A, EAN-13 and GTIN-14 of one product are one stored value (leading zeros removed), the same form the app's own barcode column uses", () => {
    for (const code of ["016000275287", "0016000275287", "00016000275287"]) expect(barcodeCandidates(code)).toEqual(["16000275287"]);
    expect(normalizeGtin("0 16000-275287")).toBe(normalizeBarcode("016000275287"));
    expect(normalizeGtin("")).toBeNull();
    expect(normalizeGtin("000000")).toBeNull();
    expect(normalizeGtin("123456789012345")).toBeNull(); // more than 14 digits is not a GTIN
  });
  it("a UPC-E is also tried as the UPC-A it stands for", () => {
    expect(expandUpcE("04252614")).toBe("042100005264");
    // the four UPC-E patterns, by the last of its six digits (0-2, 3, 4, 5-9)
    expect(expandUpcE("01234505")).toBe("012000003455");
    expect(expandUpcE("01234565")).toBe("012345000065");
    expect(expandUpcE("01234531")).toBe("012300000451");
    expect(expandUpcE("01234546")).toBe("012340000056");
    expect(expandUpcE("21234546")).toBeNull(); // not number system 0 or 1
    expect(expandUpcE("012345678905")).toBeNull();
    expect(barcodeCandidates("04252614")).toEqual(["4252614", "42100005264"]);
  });
});

describe("the hit (agreed with part A through Spot Commander)", () => {
  it("brand is brand_name, else brand_owner; units are g or ml; a key not reported is absent, never 0", () => {
    const hit = brandedHitFromRow(row());
    expect(hit).toEqual({
      fdcId: 1000001,
      description: "CHEERIOS TOASTED WHOLE GRAIN OAT CEREAL",
      brand: "Cheerios",
      gtinUpc: "16000275287",
      category: "Cereal",
      dataType: "Branded",
      per100g: { kcal: 357, protein_g: 10.7, carbs_g: 73.2, fat_g: 7.14, sugars_g: 3.57, sodium_mg: 500 },
      servingSize: 28,
      servingSizeUnit: "g",
      householdServing: "1 cup",
    });
    expect("fiber_g" in hit.per100g).toBe(false);
    expect(brandedHitFromRow(row({ brand_name: " ", brand_owner: "Fairlife, LLC" })).brand).toBe("Fairlife, LLC");
    const odd = brandedHitFromRow(row({ serving_size_unit: "oz" }));
    expect([odd.servingSize, odd.servingSizeUnit]).toEqual([null, null]);
  });
});

describe("the barcode answer from USDA's label", () => {
  it("per serving when the label gives one in g or ml, else per 100 g; the brand in front unless the name has it", () => {
    expect(brandedBarcodeResult(row())).toEqual({ description: "CHEERIOS TOASTED WHOLE GRAIN OAT CEREAL", calories: 100, proteinG: 3, carbsG: 20, fatG: 2, basis: "serving" });
    expect(brandedBarcodeResult(row({ brand_name: "fairlife", description: "REDUCED FAT 2% MILK", serving_size: null, serving_size_unit: null }))).toEqual({
      description: "fairlife REDUCED FAT 2% MILK",
      calories: 357,
      proteinG: 11,
      carbsG: 73,
      fatG: 7,
      basis: "100g",
    });
    expect(brandedBarcodeResult(row({ protein_g: null, carbs_g: null, fat_g: null }))).toBeNull();
  });
  it("is looked up under every stored form, newest first; a failed read is 'not here' (Open Food Facts is asked next)", async () => {
    const calls: { col: string; vals: string[] }[] = [];
    const db = (result: { data: unknown; error: unknown }) =>
      ({
        from: () => ({
          select: () => ({
            in: (col: string, vals: string[]) => {
              calls.push({ col, vals });
              return { order: () => ({ limit: async () => result }) };
            },
          }),
        }),
      }) as never;
    expect(await lookupBrandedBarcode(db({ data: [row()], error: null }), "016000275287")).toMatchObject({ calories: 100, basis: "serving" });
    expect(calls[0]).toEqual({ col: "gtin", vals: ["16000275287"] });
    expect(await lookupBrandedBarcode(db({ data: null, error: { message: "relation does not exist" } }), "016000275287")).toBeNull();
    expect(await lookupBrandedBarcode(db({ data: [], error: null }), "016000275287")).toBeNull();
  });
});

describe("the lookup order: USDA first, Open Food Facts exactly as before", () => {
  const usdaHit = { description: "USDA thing", calories: 100, proteinG: 1, carbsG: 2, fatG: 3, basis: "serving" as const };
  const offHit = { description: "OFF thing", calories: 90, proteinG: 1, carbsG: 2, fatG: 3, basis: "100g" as const };
  it("USDA's answer is used, and Open Food Facts is not asked", async () => {
    const off = vi.fn(async () => offHit);
    expect(await lookupBarcodeInOrder("123456", { usda: async () => usdaHit, openFoodFacts: off })).toEqual({ ok: true, result: { ...usdaHit, source: "usda" } });
    expect(off).not.toHaveBeenCalled();
  });
  it("when USDA has nothing (or cannot be read), Open Food Facts answers as before, marked as its source", async () => {
    expect(await lookupBarcodeInOrder("123456", { usda: async () => null, openFoodFacts: async () => offHit })).toEqual({ ok: true, result: { ...offHit, source: "open_food_facts" } });
    expect(await lookupBarcodeInOrder("123456", { usda: async () => Promise.reject(new Error("down")), openFoodFacts: async () => offHit })).toMatchObject({ ok: true, result: { source: "open_food_facts" } });
  });
  it("nobody has it: 404 with the same words; Open Food Facts unreachable: 502 with the same words", async () => {
    expect(await lookupBarcodeInOrder("123456", { usda: async () => null, openFoodFacts: async () => null })).toEqual({ ok: false, status: 404, error: NOT_FOUND });
    expect(await lookupBarcodeInOrder("123456", { usda: async () => null, openFoodFacts: async () => "unreachable" })).toEqual({ ok: false, status: 502, error: UNREACHABLE });
  });
  it("the route keeps its words and shape, and adds source", () => {
    const route = readFileSync(join(__dirname, "..", "app/api/food/barcode/route.ts"), "utf8");
    expect(route).toContain("lookupBarcodeInOrder(code, {");
    expect(route).toContain("usda: (c) => lookupBrandedBarcode(supabase, c),");
    expect(route).toContain("parseOpenFoodFactsResponse(");
    expect(NOT_FOUND).toBe("No nutrition data found for that barcode — try describing it instead.");
    expect(UNREACHABLE).toBe("Couldn't reach the food database — try again.");
  });
});

describe("searchBranded", () => {
  it("sends the query's words to the database search; a failed read is null, no words is []", async () => {
    const rpc = vi.fn(async () => ({ data: [row()], error: null }));
    const hits = await searchBranded({ rpc } as never, "Cheerios oat cereal", 10);
    expect(rpc).toHaveBeenCalledWith("search_branded_foods", { p_tokens: ["cheerios", "oat", "cereal"], p_limit: 10 });
    expect(hits?.[0]).toMatchObject({ fdcId: 1000001, brand: "Cheerios", dataType: "Branded" });
    expect(await searchBranded({ rpc: async () => ({ data: null, error: { message: "x" } }) } as never, "milk")).toBeNull();
    expect(await searchBranded({ rpc } as never, "  ")).toEqual([]);
    await searchBranded({ rpc } as never, "milk", 500);
    expect(rpc).toHaveBeenLastCalledWith("search_branded_foods", { p_tokens: ["milk"], p_limit: 50 });
  });
});

describe("the importer reads the Branded Foods CSV (hand-made sample: scripts/sql-tests/fixtures/branded-sample)", () => {
  const dir = join(__dirname, "..", "scripts/sql-tests/fixtures/branded-sample");
  const read = (f: string) => parseCsvRecords(readFileSync(join(dir, f), "utf8"));
  const load = () => {
    const index = new Map();
    for (const r of read("branded_food.csv")) addBranded(index, r);
    for (const r of read("food.csv")) addFoodRow(index, r);
    const nutrients = buildBrandedNutrientIndex(read("nutrient.csv"));
    for (const r of read("food_nutrient.csv")) addNutrientRow(index, nutrients, r);
    return finalizeBranded(index);
  };
  it("a quoted ingredient list over two lines, and doubled quotes, are one record", () => {
    const branded = read("branded_food.csv");
    expect(branded).toHaveLength(7);
    expect(branded[1].ingredients).toContain("\nLACTASE ENZYME");
    expect(branded[3].ingredients).toBe('PROTEIN BLEND, ALMONDS "ROASTED"');
  });
  it("keeps products with a name, kcal and a macro, inside the limits; one row per barcode, the newest; units g or ml", () => {
    const { rows, skipped } = load();
    expect(rows.map((r) => r.fdc_id)).toEqual([1000001, 1000003, 1000004, 1000005]);
    expect(skipped).toEqual({ noName: 0, noKcal: 1, noMacros: 0, outOfRange: 1, olderDuplicate: 1 });
    const milk = rows.find((r) => r.fdc_id === 1000003)!;
    // the same barcode as 1000002 (written with one more leading zero), published later; energy 208 beats the Atwater value
    expect(milk).toMatchObject({ gtin: "811620020121", kcal: 50, serving_size: 240, serving_size_unit: "ml", published_date: "2024-03-15", fiber_g: null });
    expect(rows.find((r) => r.fdc_id === 1000004)).toMatchObject({ serving_size_unit: "g", household_serving: "1 bar" });
    // a unit the app cannot weigh drops the serving, keeps the label's words
    expect(rows.find((r) => r.fdc_id === 1000005)).toMatchObject({ gtin: null, serving_size: null, serving_size_unit: null, household_serving: "1 packet" });
    expect([servingUnit("GRM"), servingUnit("MLT"), servingUnit("ONZ")]).toEqual(["g", "ml", null]);
  });
  it("writes one all-or-nothing batch that records itself, replaces an older row with the same barcode, and updates in place", () => {
    const { rows } = load();
    const sql = toBrandedBatchSql("branded-sample-0001", rows);
    expect(sql).toContain("if exists (select 1 from public.usda_load_batches where name = 'branded-sample-0001') then");
    expect(sql).toContain("where b.gtin = v.gtin and b.fdc_id <> v.fdc_id;");
    expect(sql).toContain("on conflict (fdc_id) do update set gtin = excluded.gtin");
    expect(sql).toContain("insert into public.usda_load_batches (name, rows_loaded) values ('branded-sample-0001', 4);");
    expect(() => toBrandedBatchSql("x", [{ ...rows[0], description: "bad $branded$ text" }])).toThrow(/refusing/);
  });
  it("splits a big load into batches under the size given", () => {
    const { rows } = load();
    const many = Array.from({ length: 900 }, (_, i) => ({ ...rows[0], fdc_id: 5_000_000 + i, gtin: String(70_000_000_000 + i) }));
    const groups = planBrandedBatches(many, 100_000);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flat()).toHaveLength(900);
    for (const g of groups) expect(Buffer.byteLength(toBrandedBatchSql("branded-x-0001", g))).toBeLessThan(100_000);
  });
});
