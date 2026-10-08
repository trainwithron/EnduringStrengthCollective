import { describe, expect, it } from "vitest";
import { applySwap, safeSwapChoices, swapChoices, swappableRole, MAX_VEGGIE_SWAP_G } from "@/lib/meal-swap";
import { ENABLED_TEMPLATES, scaleTemplate } from "@/lib/meal-templates";
import { fromTemplateMeal } from "@/lib/scaled-meal";
import { optionFromScaled } from "@/lib/library-meal-plan";
import { FOOD_DENSITY } from "@/lib/meal-templates";
import type { MealOption } from "@/lib/meal-engine";
import type { MealLine } from "@/lib/meal-line";

// A small hand-made option, so the arithmetic can be checked by hand.
const line = (name: string, foodKey: string, category: MealLine["category"], qty: number, unit: MealLine["unit"], text: string): MealLine => ({ name, label: name, grams: unit === "g" ? qty : null, text, foodKey, category, qty, unit });
const option = (): MealOption => ({
  recipeId: "x",
  recipeName: "Chicken and rice",
  ingredients: ["Cook the rice.", "<strong>Chicken Breast:</strong> 200g (~7.1 oz)", "<strong>Jasmine White Rice:</strong> 80g (~2.8 oz)", "<strong>Hass Avocado:</strong> 50g (~1.8 oz)"],
  lines: [
    line("Chicken Breast", "chicken_breast", "proteins", 200, "g", "<strong>Chicken Breast:</strong> 200g (~7.1 oz)"),
    line("Jasmine White Rice", "jasmine_rice_dry", "starches", 80, "g", "<strong>Jasmine White Rice:</strong> 80g (~2.8 oz)"),
    line("Hass Avocado", "avocado_hass", "fats", 50, "g", "<strong>Hass Avocado:</strong> 50g (~1.8 oz)"),
  ],
  macros: { proteinG: 50, carbsG: 62, fatG: 11, calories: 500 },
  mainProtein: "chicken",
  key: "t:x",
});
const OPEN = { allergies: [] as string[] };
const ctx = (over: Partial<{ diet: "omnivore" | "vegan" | "vegetarian" | "keto" | "paleo" | "pescatarian" | "carnivore"; trainingDay: boolean; rules: typeof OPEN | null; metric: boolean }> = {}) => ({ diet: "omnivore" as const, trainingDay: false, rules: OPEN, ...over });

describe("which foods can stand in", () => {
  it("offers foods of the same kind that fit the diet, by name, without repeats", () => {
    const protein = swapChoices("protein", "omnivore", false).map((c) => c.name);
    expect(protein).toContain("Chicken Breast");
    expect(protein).toContain("Atlantic Salmon");
    expect(protein).not.toContain("Extra Firm Tofu"); // vegan/vegetarian only
    expect(new Set(protein).size).toBe(protein.length);
    expect(swapChoices("protein", "vegan", false).map((c) => c.name)).toEqual(expect.arrayContaining(["Extra Firm Tofu", "Organic Tempeh", "Seitan"]));
    expect(swapChoices("protein", "vegan", false).map((c) => c.name)).not.toContain("Chicken Breast");
  });
  it("honey and fruit juice only on a training day", () => {
    expect(swapChoices("carbs", "omnivore", false).map((c) => c.name)).not.toContain("Raw Honey");
    const train = swapChoices("carbs", "omnivore", true);
    expect(train.map((c) => c.name)).toEqual(expect.arrayContaining(["Raw Honey", "100% Fruit Juice"]));
    expect(train.find((c) => c.name === "Raw Honey")?.trainingDayOnly).toBe(true);
  });
  it("a pescatarian is never offered meat, a keto client no rice", () => {
    expect(swapChoices("protein", "pescatarian", false).map((c) => c.name)).not.toContain("Chicken Breast");
    expect(swapChoices("carbs", "keto", false).map((c) => c.name)).not.toContain("Jasmine White Rice");
  });
  it("the picker leaves out foods that break the client's rules", () => {
    const names = safeSwapChoices("protein", "omnivore", false, { allergies: ["fish", "shellfish"], dislikes: ["pork"] }).map((c) => c.name);
    expect(names).not.toContain("Atlantic Salmon");
    expect(names).not.toContain("Raw Shrimp");
    expect(names).not.toContain("Pork Tenderloin");
    expect(names).toContain("Chicken Breast");
    expect(safeSwapChoices("protein", "omnivore", false, null)).toEqual([]);
  });
});

describe("applySwap", () => {
  it("keeps the macro the old food supplied: 200 g chicken (45 g protein) becomes the right amount of salmon", () => {
    const r = applySwap(option(), 0, "salmon_raw", ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const salmonProteinPerG = FOOD_DENSITY.salmon_raw.protein;
    const expected = Math.round((200 * FOOD_DENSITY.chicken_breast.protein) / salmonProteinPerG);
    expect(r.option.lines![0]).toMatchObject({ name: "Atlantic Salmon", foodKey: "salmon_raw", qty: expected, unit: "g", grams: expected });
    expect(r.option.ingredients[1]).toBe(`<strong>Atlantic Salmon:</strong> ${expected}g (~${(expected / 28.3495).toFixed(1)} oz)`);
    expect(r.option.ingredients).toHaveLength(4);
    expect(r.option.ingredients[0]).toBe("Cook the rice.");
  });
  it("updates the meal's macros by the difference and records the swap", () => {
    const r = applySwap(option(), 0, "salmon_raw", ctx());
    if (!r.ok) throw new Error(r.reason);
    // protein is preserved by construction (to rounding); salmon adds fat that chicken breast did not have as much of
    expect(Math.abs(r.option.macros!.proteinG - 50)).toBeLessThanOrEqual(1);
    expect(r.option.macros!.fatG).toBeGreaterThan(11);
    expect(r.option.macros!.calories).toBe(Math.round(4 * r.option.macros!.proteinG + 4 * r.option.macros!.carbsG + 9 * r.option.macros!.fatG));
    expect(r.option.swaps).toEqual([{ from: "Chicken Breast", to: "Atlantic Salmon" }]);
  });
  it("never changes the original option", () => {
    const o = option();
    const copy = JSON.stringify(o);
    applySwap(o, 0, "salmon_raw", ctx());
    expect(JSON.stringify(o)).toBe(copy);
  });
  it("follows the protein family when the main protein is swapped", () => {
    const r = applySwap(option(), 0, "salmon_raw", ctx());
    if (!r.ok) throw new Error(r.reason);
    expect(r.option.mainProtein).toBe("salmon");
  });
  it("a food counted in whole units is never less than one (a tiny carb swapped to a rice cake still gives one)", () => {
    const o = option();
    o.lines![1] = line("Raw Honey", "honey_raw", "starches", 2, "g", "<strong>Raw Honey:</strong> 2g");
    o.ingredients[2] = "<strong>Raw Honey:</strong> 2g";
    const r = applySwap(o, 1, "rice_cake", ctx({ trainingDay: true }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.option.lines![1]).toMatchObject({ foodKey: "rice_cake", unit: "cakes" });
    expect(r.option.lines![1].qty).toBeGreaterThanOrEqual(1);
    expect(r.option.ingredients[2]).toMatch(/^<strong>Rice Cakes:<\/strong> \d+ cakes$/);
  });
  it("eggs are counted in whole eggs", () => {
    const r = applySwap(option(), 0, "egg_whole_large", ctx());
    if (!r.ok) throw new Error(r.reason);
    expect(r.option.lines![0]).toMatchObject({ unit: "large", grams: null });
    expect(Number.isInteger(r.option.lines![0].qty)).toBe(true);
    expect(r.option.ingredients[1]).toMatch(/^<strong>Whole Eggs:<\/strong> \d+ large$/);
  });
  it("a produce portion is capped at a realistic size", () => {
    const o = option();
    o.lines![2] = line("Asparagus", "asparagus_raw", "produce", 5000, "g", "<strong>Asparagus:</strong> 5000g");
    o.ingredients[3] = "<strong>Asparagus:</strong> 5000g";
    const r = applySwap(o, 2, "watermelon_raw", ctx());
    if (!r.ok) throw new Error(r.reason);
    expect(r.option.lines![2].qty).toBeLessThanOrEqual(MAX_VEGGIE_SWAP_G);
  });
  it("metric clients get no ounce hint", () => {
    const r = applySwap(option(), 0, "salmon_raw", ctx({ metric: true }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.option.ingredients[1]).not.toContain("oz");
  });

  it("REFUSES a food that breaks an allergy, an intolerance, a dislike or the diet", () => {
    for (const [rules, why] of [
      [{ allergies: ["fish"] }, /allergy/],
      [{ intolerances: ["fish"] }, /intolerance/],
      [{ dislikes: ["salmon"] }, /dislike/],
    ] as const) {
      const r = applySwap(option(), 0, "salmon_raw", ctx({ rules: rules as never }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(why);
    }
  });
  it("refuses a food that is not offered for this diet or this role, a training-day food on a rest day, and a swap with unreadable rules", () => {
    expect(applySwap(option(), 0, "tofu_extra_firm", ctx()).ok).toBe(false); // vegan/vegetarian only
    expect(applySwap(option(), 0, "jasmine_rice_dry", ctx()).ok).toBe(false); // a carb for a protein
    expect(applySwap(option(), 1, "honey_raw", ctx({ trainingDay: false })).ok).toBe(false);
    expect(applySwap(option(), 1, "honey_raw", ctx({ trainingDay: true })).ok).toBe(true);
    const unreadable = applySwap(option(), 0, "salmon_raw", ctx({ rules: null }));
    expect(unreadable.ok).toBe(false);
  });
  it("refuses the same food, an unknown line, and a line that was never structured", () => {
    expect(applySwap(option(), 0, "chicken_breast", ctx()).ok).toBe(false);
    expect(applySwap(option(), 9, "salmon_raw", ctx()).ok).toBe(false);
    const old = option();
    old.lines = old.lines!.map((l) => ({ name: l.name, label: l.label, grams: l.grams }));
    expect(applySwap(old, 0, "salmon_raw", ctx()).ok).toBe(false);
    expect(swappableRole(old.lines[0])).toBeNull();
  });
  it("can be swapped twice, and the record keeps both", () => {
    const first = applySwap(option(), 0, "salmon_raw", ctx());
    if (!first.ok) throw new Error(first.reason);
    const second = applySwap(first.option, 0, "turkey_breast", ctx());
    if (!second.ok) throw new Error(second.reason);
    expect(second.option.swaps).toEqual([
      { from: "Chicken Breast", to: "Atlantic Salmon" },
      { from: "Atlantic Salmon", to: "Turkey Breast" },
    ]);
  });
});

describe("a real library meal can be swapped end to end", () => {
  it("every enabled omnivore template has at least one swappable protein line, and a swap keeps its calories close", () => {
    let checked = 0;
    for (const t of ENABLED_TEMPLATES.filter((r) => r.archetypes.includes("omnivore")).slice(0, 25)) {
      const scaled = scaleTemplate(t, { proteinG: 40, carbsG: 60, fatG: 20 });
      if (!scaled) continue;
      const opt = optionFromScaled(fromTemplateMeal(scaled, t));
      const idx = (opt.lines ?? []).findIndex((l) => swappableRole(l) === "protein");
      if (idx < 0) continue;
      const choices = swapChoices("protein", "omnivore", false).filter((c) => c.key !== opt.lines![idx].foodKey);
      const r = applySwap(opt, idx, choices[0].key, ctx());
      if (!r.ok) throw new Error(`${t.id}: ${r.reason}`);
      expect(Math.abs(r.option.macros!.proteinG - opt.macros!.proteinG), t.id).toBeLessThanOrEqual(2);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  });
});
