import { describe, expect, it } from "vitest";
import { buildAiRecipeRows, contentHashOf } from "./ai-recipe-save";
import type { MealOption } from "./meal-engine";

const option = (over: Partial<MealOption> = {}): MealOption => ({
  recipeId: "ai-1",
  recipeName: "Salmon rice bowl",
  ingredients: ["200g salmon", "250g rice", "1 cup spinach"],
  isAi: true,
  verifiedMacros: { protein: 52, carbs: 70, fat: 28, kcal: 740 },
  aiLines: [
    { rawLine: "200g salmon", name: "Atlantic salmon, raw", grams: 200, fdcId: 175167, proteinG: 40, carbsG: 0, fatG: 26 },
    { rawLine: "250g cooked rice", name: "White rice, cooked", grams: 250, fdcId: 168878, proteinG: 6.75, carbsG: 70, fatG: 0.75 },
    { rawLine: "1 cup spinach", name: "Spinach, raw", grams: 30, fdcId: 168462, proteinG: 0.9, carbsG: 1.1, fatG: 0.1 },
  ],
  ...over,
});

describe("saving an approved AI option to the library", () => {
  it("makes a private AI recipe with reference grams, roles, tags and a fingerprint", async () => {
    const r = await buildAiRecipeRows(option(), "dinner", new Date("2026-10-07T12:00:00Z"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { recipe, ingredients } = r.rows;
    expect(recipe).toMatchObject({ name: "Salmon rice bowl", slot: "dinner", source: "ai", visibility: "private", verified_at: "2026-10-07T12:00:00.000Z" });
    expect(recipe.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(recipe.reference_macros).toEqual({ protein: 52, carbs: 70, fat: 28, kcal: 740 });
    expect(recipe.allergens).toContain("fish");
    expect(recipe.diet_tags).toContain("omnivore");
    expect(recipe.diet_tags).not.toContain("vegetarian");
    expect(recipe.main_protein).toBe("salmon");
    const salmon = ingredients[0];
    expect(salmon).toMatchObject({ role: "protein_source", grams_ref: 200, usda_fdc_id: 175167, protein_per_100g: 20, fat_per_100g: 13 });
    expect(ingredients[1]).toMatchObject({ role: "carb_source", grams_ref: 250 });
    // The handful of spinach adds almost nothing: it is a text line, shown but not scaled, and needs no matched food.
    expect(ingredients[2]).toMatchObject({ role: "fixed", fixed_display_text: "1 cup spinach", usda_fdc_id: null, grams_ref: null });
  });
  it("the same foods in the same amounts give the same fingerprint, whatever the recipe is called or the order of its lines", async () => {
    const a = await buildAiRecipeRows(option(), "dinner");
    const b = await buildAiRecipeRows(option({ recipeName: "Renamed", aiLines: [...option().aiLines!].reverse() }), "dinner");
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.rows.recipe.content_hash).toBe(b.rows.recipe.content_hash);
    const c = await buildAiRecipeRows(option({ aiLines: option().aiLines!.map((l) => (l.fdcId === 175167 ? { ...l, grams: 220 } : l)) }), "dinner");
    if (!c.ok) throw new Error("expected ok");
    expect(c.rows.recipe.content_hash).not.toBe(a.rows.recipe.content_hash);
    expect(await contentHashOf([{ label: "Rice", grams: 100 }])).toMatch(/^[0-9a-f]{64}$/);
  });
  it("tags a meat-free recipe as vegetarian and a dairy one with dairy", async () => {
    const r = await buildAiRecipeRows(
      option({
        recipeName: "Greek yogurt bowl",
        aiLines: [
          { rawLine: "250g greek yogurt", name: "Greek yogurt, plain, nonfat", grams: 250, fdcId: 1, proteinG: 25, carbsG: 9, fatG: 1 },
          { rawLine: "60g oats", name: "Oats", grams: 60, fdcId: 2, proteinG: 8, carbsG: 40, fatG: 4 },
        ],
      }),
      "breakfast"
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.rows.recipe.diet_tags).toEqual(expect.arrayContaining(["omnivore", "vegetarian"]));
    expect(r.rows.recipe.allergens).toContain("dairy");
  });
  it("refuses what the database would refuse: a measured line with no matched food, a non-AI option, no verified macros, nothing to scale", async () => {
    const noMatch = await buildAiRecipeRows(option({ aiLines: [{ rawLine: "200g mystery", name: null, grams: 200, fdcId: null, proteinG: 30, carbsG: 0, fatG: 5 }] }), "dinner");
    expect(noMatch).toMatchObject({ ok: false });
    expect((noMatch as { reason: string }).reason).toMatch(/not matched to a real food/);
    expect(await buildAiRecipeRows(option({ isAi: false }), "dinner")).toMatchObject({ ok: false });
    expect(await buildAiRecipeRows(option({ verifiedMacros: undefined }), "dinner")).toMatchObject({ ok: false });
    expect(await buildAiRecipeRows(option({ aiLines: [{ rawLine: "1 cup spinach", name: "Spinach", grams: 30, fdcId: 3, proteinG: 0.9, carbsG: 1.1, fatG: 0.1 }] }), "dinner")).toMatchObject({ ok: false });
    expect(await buildAiRecipeRows(option({ aiLines: [{ rawLine: "x", name: "Big", grams: 2500, fdcId: 4, proteinG: 500, carbsG: 0, fatG: 0 }] }), "dinner")).toMatchObject({ ok: false });
  });
});
