import { describe, expect, it } from "vitest";
import { escapeLike, loadFoodDetail, rankFoodRows, scoreFood, searchFoods, tokenize, type FoodRow } from "@/lib/food-search";

const row = (fdc_id: number, description: string, data_type = "SR Legacy"): FoodRow => ({ fdc_id, description, data_type, food_category: null });

describe("tokenize", () => {
  it("lower-cases, splits on anything that is not a letter or digit, drops single letters and repeats", () => {
    expect(tokenize("Chicken, Breast & a CHICKEN!")).toEqual(["chicken", "breast"]);
    expect(tokenize("2% milk")).toEqual(["2", "milk"]);
    expect(tokenize("   ")).toEqual([]);
  });
  it("keeps at most six words", () => {
    expect(tokenize("one two three four five six seven eight")).toHaveLength(6);
  });
});

describe("escapeLike", () => {
  it("escapes percent, underscore and backslash so a person cannot widen the pattern", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("ranking", () => {
  const rows = [
    row(1, "Soup, chicken noodle, canned, condensed"),
    row(2, "Chicken, broilers or fryers, breast, meat only, cooked, roasted"),
    row(3, "Babyfood, dinner, chicken noodle, strained"),
    row(4, "Chicken, broilers or fryers, breast, meat only, raw", "Foundation"),
    row(5, "Rice, white, long-grain, regular, enriched, cooked"),
  ];
  it("puts the food the person means before foods that merely mention the word", () => {
    const ranked = rankFoodRows(rows, "chicken breast");
    expect(ranked.slice(0, 2).map((r) => r.fdc_id).sort()).toEqual([2, 4]);
    expect(ranked[ranked.length - 1].fdc_id).not.toBe(2);
    expect(ranked.map((r) => r.fdc_id).indexOf(1)).toBeGreaterThan(1);
  });
  it("prefers the shorter, simpler name and the Foundation record on a near tie", () => {
    const ranked = rankFoodRows([row(10, "Chicken, broilers or fryers, breast, meat only, cooked, roasted"), row(11, "Chicken, breast, raw", "Foundation")], "chicken");
    expect(ranked[0].fdc_id).toBe(11);
  });
  it("a name that is exactly the query wins", () => {
    const ranked = rankFoodRows([row(20, "Egg, whole, cooked, hard-boiled"), row(21, "Egg")], "egg");
    expect(ranked[0].fdc_id).toBe(21);
  });
  it("an empty query scores nothing", () => {
    expect(scoreFood(row(1, "Rice"), [])).toBe(0);
  });
  it("respects the limit and does not change its input", () => {
    const copy = [...rows];
    expect(rankFoodRows(rows, "chicken", 2)).toHaveLength(2);
    expect(rows).toEqual(copy);
  });
});

// A small fake of the Supabase query builder, enough for the two reads each function makes.
function fakeSupabase(tables: Record<string, unknown[]>, failOn: string[] = []) {
  const calls: { table: string; ilike: string[] }[] = [];
  const from = (table: string) => {
    const state = { ilike: [] as string[] };
    calls.push({ table, ilike: state.ilike });
    const rows = (): unknown[] => (tables[table] ?? []);
    const result = () => ({ data: failOn.includes(table) ? null : rows(), error: failOn.includes(table) ? { message: "boom" } : null });
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.ilike = (_c: string, pattern: string) => { state.ilike.push(pattern); return chain; };
    chain.in = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = () => Promise.resolve(result());
    chain.maybeSingle = () => Promise.resolve({ data: failOn.includes(table) ? null : (rows()[0] ?? null), error: failOn.includes(table) ? { message: "boom" } : null });
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  };
  return { client: { from } as never, calls };
}

describe("searchFoods", () => {
  it("matches every word, ranks, and attaches the four macros per 100 g", async () => {
    const { client, calls } = fakeSupabase({
      usda_foods: [row(2, "Chicken, broilers or fryers, breast, meat only, cooked, roasted"), row(1, "Soup, chicken noodle")],
      usda_food_nutrients: [
        { fdc_id: 2, nutrient_key: "kcal", amount_per_100g: 165 },
        { fdc_id: 2, nutrient_key: "protein_g", amount_per_100g: 31 },
      ],
    });
    const hits = await searchFoods(client, "chicken breast");
    expect(calls[0].ilike).toEqual(["%chicken%", "%breast%"]);
    expect(hits[0].fdcId).toBe(2);
    expect(hits[0].per100g).toEqual({ kcal: 165, protein_g: 31 });
    // a food with no nutrient rows is still listed, with nothing claimed about it
    expect(hits.find((h) => h.fdcId === 1)?.per100g).toEqual({});
  });
  it("returns nothing for an empty query or a failed read", async () => {
    const { client } = fakeSupabase({ usda_foods: [row(1, "Rice")] });
    expect(await searchFoods(client, "  ")).toEqual([]);
    const failing = fakeSupabase({ usda_foods: [row(1, "Rice")] }, ["usda_foods"]);
    expect(await searchFoods(failing.client, "rice")).toEqual([]);
  });
  it("cannot be used to widen the pattern: wildcard characters in the query never reach it", async () => {
    const { client, calls } = fakeSupabase({ usda_foods: [] });
    await searchFoods(client, "100%_ rice");
    expect(calls[0].ilike).toEqual(["%100%", "%rice%"]);
    const wild = fakeSupabase({ usda_foods: [] });
    await searchFoods(wild.client, "%%%___");
    expect(wild.calls).toHaveLength(0);
  });
});

describe("loadFoodDetail", () => {
  it("returns per-100 g nutrients and household portions in order", async () => {
    const { client } = fakeSupabase({
      usda_foods: [{ fdc_id: 7, description: "Rice, white, cooked" }],
      usda_food_nutrients: [{ nutrient_key: "kcal", amount_per_100g: 130 }, { nutrient_key: "fiber_g", amount_per_100g: 0.4 }],
      usda_food_portions: [{ seq: 1, description: "1 cup", gram_weight: 158 }],
    });
    const d = await loadFoodDetail(client, 7);
    expect(d).toEqual({ fdcId: 7, description: "Rice, white, cooked", per100g: { kcal: 130, fiber_g: 0.4 }, portions: [{ seq: 1, description: "1 cup", gramWeight: 158 }] });
  });
  it("works with no portions loaded", async () => {
    const { client } = fakeSupabase({ usda_foods: [{ fdc_id: 7, description: "Rice" }], usda_food_nutrients: [] });
    const d = await loadFoodDetail(client, 7);
    expect(d?.portions).toEqual([]);
  });
  it("is null for an unknown food", async () => {
    const { client } = fakeSupabase({ usda_foods: [] });
    expect(await loadFoodDetail(client, 999)).toBeNull();
  });
});
