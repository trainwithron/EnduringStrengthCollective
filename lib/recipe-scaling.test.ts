import { describe, it, expect } from "vitest";
import { scaleRecipe, formatIngredientLineHtml, type RecipeIngredientDef } from "./recipe-scaling";

const chicken: RecipeIngredientDef = {
  id: "chicken",
  label: "Chicken Breast",
  role: "protein_source",
  proteinPer100g: 31,
  carbsPer100g: 0,
  fatPer100g: 3.6,
  fixedDisplayText: null,
};

const rice: RecipeIngredientDef = {
  id: "rice",
  label: "Jasmine Rice",
  role: "carb_source",
  proteinPer100g: 7,
  carbsPer100g: 80,
  fatPer100g: 0,
  fixedDisplayText: null,
};

const oil: RecipeIngredientDef = {
  id: "oil",
  label: "Olive Oil",
  role: "fat_source",
  proteinPer100g: 0,
  carbsPer100g: 0,
  fatPer100g: 100,
  fixedDisplayText: null,
};

const veggies: RecipeIngredientDef = {
  id: "veggies",
  label: "Steamed Broccoli",
  role: "fixed",
  proteinPer100g: 0,
  carbsPer100g: 0,
  fatPer100g: 0,
  fixedDisplayText: "1-2 cups",
};

describe("scaleRecipe", () => {
  it("solves each adjustable ingredient's grams directly from its own macro target", () => {
    const result = scaleRecipe([chicken, rice, oil, veggies], { protein: 40, carbs: 50, fat: 15 });
    const byId = Object.fromEntries(result.map((r) => [r.ingredientId, r]));

    expect(byId.chicken.grams).toBe(129); // 40 / 0.31
    expect(byId.rice.grams).toBe(63); // 50 / 0.80
    expect(byId.oil.grams).toBe(15); // 15 / 1.00
  });

  it("never scales a fixed ingredient and renders its static text as-is", () => {
    const result = scaleRecipe([veggies], { protein: 999, carbs: 999, fat: 999 });
    expect(result[0].grams).toBeNull();
    expect(result[0].displayText).toBe("Steamed Broccoli: 1-2 cups");
  });

  it("renders a fixed ingredient with no display text as just its label", () => {
    const bare: RecipeIngredientDef = { ...veggies, fixedDisplayText: null };
    const result = scaleRecipe([bare], { protein: 0, carbs: 0, fat: 0 });
    expect(result[0].displayText).toBe("Steamed Broccoli");
  });

  it("scales down correctly for a smaller target", () => {
    const result = scaleRecipe([chicken], { protein: 20, carbs: 0, fat: 0 });
    expect(result[0].grams).toBe(65); // 20 / 0.31 = 64.5 -> rounds to 65 (Math.round bankers-free)
  });

  it("returns 0 grams instead of a negative or NaN when density is zero", () => {
    const noProtein: RecipeIngredientDef = { ...chicken, proteinPer100g: 0 };
    const result = scaleRecipe([noProtein], { protein: 40, carbs: 0, fat: 0 });
    expect(result[0].grams).toBe(0);
  });

  it("formats the oz conversion to one decimal place", () => {
    const result = scaleRecipe([chicken], { protein: 31, carbs: 0, fat: 0 });
    // 100g chicken -> 100/28.35 = 3.5273... -> "3.5"
    expect(result[0].grams).toBe(100);
    expect(result[0].displayText).toContain("(~3.5 oz)");
  });

  it("preserves ingredient order in the output", () => {
    const result = scaleRecipe([oil, chicken, rice], { protein: 10, carbs: 10, fat: 10 });
    expect(result.map((r) => r.ingredientId)).toEqual(["oil", "chicken", "rice"]);
  });
});

describe("formatIngredientLineHtml", () => {
  it("bolds only the label and colon, matching the built-in recipe convention", () => {
    const [line] = scaleRecipe([chicken], { protein: 31, carbs: 0, fat: 0 });
    expect(formatIngredientLineHtml(line)).toBe("<strong>Chicken Breast:</strong> 100g (~3.5 oz)");
  });

  it("formats a fixed ingredient with display text the same way", () => {
    const [line] = scaleRecipe([veggies], { protein: 0, carbs: 0, fat: 0 });
    expect(formatIngredientLineHtml(line)).toBe("<strong>Steamed Broccoli:</strong> 1-2 cups");
  });

  it("bolds a bare label with no colon when a fixed ingredient has no display text", () => {
    const bare: RecipeIngredientDef = { ...veggies, fixedDisplayText: null };
    const [line] = scaleRecipe([bare], { protein: 0, carbs: 0, fat: 0 });
    expect(formatIngredientLineHtml(line)).toBe("<strong>Steamed Broccoli</strong>");
  });
});
