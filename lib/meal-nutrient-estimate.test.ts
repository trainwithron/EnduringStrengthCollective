import { describe, it, expect } from "vitest";
import { estimateMealMicronutrients } from "./meal-nutrient-estimate";
import type { RecipeIngredientDef } from "./recipe-scaling";

const chicken: RecipeIngredientDef = {
  id: "chicken_breast",
  label: "Chicken Breast",
  role: "protein_source",
  proteinPer100g: 23,
  carbsPer100g: 0,
  fatPer100g: 2.5,
  fixedDisplayText: null,
  usdaFdcId: 1,
};

const rice: RecipeIngredientDef = {
  id: "jasmine_rice_dry",
  label: "Jasmine Rice",
  role: "carb_source",
  proteinPer100g: 7,
  carbsPer100g: 80,
  fatPer100g: 0,
  fixedDisplayText: null,
  usdaFdcId: null, // deliberately unmapped
};

const nutrientsByFdcId = new Map([[1, new Map([["iron_mg", 1], ["sodium_mg", 65]])]]);

describe("estimateMealMicronutrients", () => {
  it("scales a mapped ingredient's per-100g nutrients by its real computed grams", () => {
    const result = estimateMealMicronutrients([chicken], { protein: 46, carbs: 0, fat: 0 }, nutrientsByFdcId);
    // 46g protein / 23g-per-100g density = 200g of chicken.
    expect(result.totals.iron_mg).toBeCloseTo(2, 5);
    expect(result.totals.sodium_mg).toBeCloseTo(130, 5);
  });

  it("skips ingredients with no USDA mapping and reports partial coverage", () => {
    const result = estimateMealMicronutrients([chicken, rice], { protein: 23, carbs: 80, fat: 0 }, nutrientsByFdcId);
    expect(result.coveredIngredientCount).toBe(1);
    expect(result.totalIngredientCount).toBe(2);
  });

  it("returns zero totals and zero coverage for an empty ingredient list", () => {
    const result = estimateMealMicronutrients([], { protein: 0, carbs: 0, fat: 0 }, nutrientsByFdcId);
    expect(result.coveredIngredientCount).toBe(0);
    expect(result.totalIngredientCount).toBe(0);
    expect(Object.values(result.totals).every((v) => v === 0)).toBe(true);
  });

  it("skips a fdcId that has no cached nutrient row at all", () => {
    const unmappedFood: RecipeIngredientDef = { ...chicken, usdaFdcId: 999 };
    const result = estimateMealMicronutrients([unmappedFood], { protein: 23, carbs: 0, fat: 0 }, nutrientsByFdcId);
    expect(result.coveredIngredientCount).toBe(0);
    expect(result.totals.iron_mg).toBe(0);
  });
});
