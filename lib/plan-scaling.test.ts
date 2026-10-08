import { describe, expect, it } from "vitest";
import { describeScaleReport, plannedCalories, scaleChoice, scaleEntry, scalePlanRow, scaledQty } from "@/lib/plan-scaling";
import { ENABLED_TEMPLATES, scaleTemplate } from "@/lib/meal-templates";
import { fromTemplateMeal } from "@/lib/scaled-meal";
import { choiceFromOption, optionFromScaled } from "@/lib/library-meal-plan";
import type { MealEntryPayload, MealRecipeChoice } from "@/lib/meal-plan-assignment";

const TARGET = { proteinG: 40, carbsG: 60, fatG: 20 };

// A real saved choice from a starter-library template, scaled to the slot target.
function libraryChoice(slot: "breakfast" | "lunch" | "dinner", skip = 0): MealRecipeChoice {
  const list = ENABLED_TEMPLATES.filter((t) => t.slot === slot && t.archetypes.includes("omnivore"));
  let n = 0;
  for (const t of list) {
    const s = scaleTemplate(t, TARGET);
    if (!s) continue;
    if (n++ < skip) continue;
    return choiceFromOption(optionFromScaled(fromTemplateMeal(s, t)));
  }
  throw new Error("no template fits");
}
const entry = (recipes: MealRecipeChoice[], extra: Partial<MealEntryPayload> = {}): MealEntryPayload => ({ mealId: "1", title: "Lunch", proteinTarget: TARGET.proteinG, carbsTarget: TARGET.carbsG, fatTarget: TARGET.fatG, recipes, ...extra });

describe("scaledQty", () => {
  it("grams to the nearest 5, never under 5; whole foods to the nearest whole one, never under one", () => {
    expect(scaledQty({ foodKey: "chicken_breast", qty: 200, unit: "g" }, 1.1)).toBe(220);
    expect(scaledQty({ foodKey: "chicken_breast", qty: 203, unit: "g" }, 1)).toBe(205);
    expect(scaledQty({ foodKey: "olive_oil_g", qty: 6, unit: "g" }, 0.5)).toBe(5);
    expect(scaledQty({ foodKey: "egg_whole_large", qty: 3, unit: "large" }, 1.2)).toBe(4);
    expect(scaledQty({ foodKey: "egg_whole_large", qty: 2, unit: "large" }, 0.2)).toBe(1);
    expect(scaledQty({ foodKey: "sourdough_slice", qty: 2, unit: "slices" }, 1.5)).toBe(3);
  });
});

describe("scaleChoice", () => {
  it("scales every line, reprints it, and recomputes the macros from the new amounts", () => {
    const c = libraryChoice("lunch");
    const s = scaleChoice(c, 1.1)!;
    expect(s).not.toBeNull();
    expect(s.choice.macros!.calories).toBeGreaterThan(c.macros!.calories);
    expect(Math.abs(s.choice.macros!.calories / c.macros!.calories - 1.1)).toBeLessThan(0.08);
    s.choice.lines!.forEach((l, i) => {
      expect(l.qty).toBe(scaledQty({ foodKey: c.lines![i].foodKey!, qty: c.lines![i].qty!, unit: c.lines![i].unit! }, 1.1));
      expect(s.choice.ingredients).toContain(l.text);
    });
    expect(s.choice.ingredients.length).toBe(c.ingredients.length);
  });
  it("never changes the original", () => {
    const c = libraryChoice("lunch");
    const copy = JSON.stringify(c);
    scaleChoice(c, 0.8);
    expect(JSON.stringify(c)).toBe(copy);
  });
  it("cannot scale an option without stored amounts (a coach recipe, an older plan)", () => {
    expect(scaleChoice({ recipeId: "r", recipeName: "Mine", ingredients: ["200g chicken"], lines: [{ name: "Chicken", label: "Chicken", grams: 200 }] }, 1.1)).toBeNull();
    expect(scaleChoice({ recipeId: "r", recipeName: "Old", ingredients: ["x"] }, 1.1)).toBeNull();
  });
});

describe("scaleEntry", () => {
  it("a modest change keeps the options and updates the slot targets", () => {
    const e = entry([libraryChoice("lunch", 0), libraryChoice("lunch", 1), libraryChoice("lunch", 2)]);
    const r = scaleEntry(e, 1.08);
    expect(r.entry.proteinTarget).toBe(Math.round(40 * 1.08));
    expect(r.report.optionsScaled + r.report.optionsDropped).toBe(3);
    expect(r.entry.recipes!.length).toBe(r.report.optionsScaled);
    expect(r.report.optionsScaled).toBeGreaterThanOrEqual(1);
  });
  it("a huge change that nothing fits keeps the single best option and reports the slot for rebuilding", () => {
    const e = entry([libraryChoice("lunch", 0), libraryChoice("lunch", 1)]);
    const r = scaleEntry(e, 2.6);
    expect(r.report.slotsToRebuild + r.report.optionsScaled).toBeGreaterThanOrEqual(1);
    expect(r.entry.recipes!.length).toBeGreaterThanOrEqual(1);
  });
  it("leaves options it cannot scale exactly as they were and says so", () => {
    const mine: MealRecipeChoice = { recipeId: "r", recipeName: "Mine", ingredients: ["200g chicken"], lines: [{ name: "Chicken", label: "Chicken", grams: 200 }] };
    const r = scaleEntry(entry([mine, libraryChoice("lunch")]), 1.05);
    expect(r.report.optionsLeftAlone).toBe(1);
    expect(r.entry.recipes![0]).toEqual(mine);
  });
  it("keeps the featured option featured when it survives", () => {
    const e = entry([libraryChoice("lunch", 0), libraryChoice("lunch", 1), libraryChoice("lunch", 2)], { featuredIndex: 1 });
    const featuredName = e.recipes![1].recipeName;
    const r = scaleEntry(e, 1.02);
    const at = r.entry.recipes!.findIndex((c) => c.recipeName === featuredName);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(r.entry.featuredIndex ?? 0).toBe(at > 0 ? at : 0);
  });
});

describe("scalePlanRow", () => {
  const macros = { daily: { calories: 2000, protein: 160, carbs: 200, fats: 60 } };
  it("scales every menu in the day and the day's macros", () => {
    const row = { macros, meals: { daily: [entry([libraryChoice("lunch")])] } };
    const r = scalePlanRow(row, 1.1);
    expect(r.macros.daily).toMatchObject({ calories: 2200, protein: 176, carbs: 220, fats: 66 });
    expect(r.meals.daily[0].proteinTarget).toBe(44);
  });
  it("a daily day takes the exact new target when it is given", () => {
    const r = scalePlanRow({ macros, meals: { daily: [] } }, 1.1, { exactDaily: { calories: 2210, protein: 170, carbs: 215, fats: 66 } });
    expect(r.macros.daily).toMatchObject({ calories: 2210, protein: 170, carbs: 215, fats: 66 });
  });
  it("a carb-cycling day scales both its training and its rest menus", () => {
    const row = { macros: { train: { calories: 2400, protein: 160, carbs: 300, fats: 60 }, rest: { calories: 2000, protein: 160, carbs: 200, fats: 60 } }, meals: { train: [entry([libraryChoice("lunch")])], rest: [entry([libraryChoice("lunch")])] } };
    const r = scalePlanRow(row, 0.9);
    expect(r.macros.train).toMatchObject({ calories: 2160 });
    expect(r.macros.rest).toMatchObject({ calories: 1800 });
    expect(Object.keys(r.meals).sort()).toEqual(["rest", "train"]);
  });
});

describe("plannedCalories and the report", () => {
  it("reads the daily calories, or the average of the training and rest menus", () => {
    expect(plannedCalories({ daily: { calories: 2000 } })).toBe(2000);
    expect(plannedCalories({ train: { calories: 2400 }, rest: { calories: 2000 } })).toBe(2200);
    expect(plannedCalories({})).toBeNull();
  });
  it("describes what happened in plain words", () => {
    const text = describeScaleReport({ optionsScaled: 12, optionsLeftAlone: 2, optionsDropped: 1, slotsToRebuild: 1 }, 5);
    expect(text).toContain("Scaled 12 meals across 5 days");
    expect(text).toContain("1 option no longer fit and was removed");
    expect(text).toContain("1 meal slot has no option that fits any more");
    expect(text).toContain("2 options");
  });
});
