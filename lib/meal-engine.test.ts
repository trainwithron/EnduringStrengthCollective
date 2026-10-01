import { describe, it, expect } from "vitest";
import {
  computeCarbCyclingTargets,
  matchFlexTreat,
  buildMealSpecs,
  generateMealOptions,
  detectDietArchetype,
} from "./meal-engine";

describe("detectDietArchetype", () => {
  it("detects each archetype from free text, defaulting to omnivore", () => {
    expect(detectDietArchetype("Vegan, no dairy")).toBe("vegan");
    expect(detectDietArchetype("Strict carnivore")).toBe("carnivore");
    expect(detectDietArchetype("Keto / ketogenic")).toBe("keto");
    expect(detectDietArchetype("Paleo only")).toBe("paleo");
    expect(detectDietArchetype("Vegetarian")).toBe("vegetarian");
    expect(detectDietArchetype("No sourdough, no eggs")).toBe("omnivore");
  });
});

describe("computeCarbCyclingTargets", () => {
  it("gives training days more calories and carbs than rest days at the same weekly budget", () => {
    const baseline = { calories: 2400, protein: 180, carbs: 220, fats: 70 };
    const { trainingDay, restDay } = computeCarbCyclingTargets(baseline, 4);
    expect(trainingDay.calories).toBeGreaterThan(restDay.calories);
    expect(trainingDay.carbs).toBeGreaterThan(restDay.carbs);
    expect(trainingDay.protein).toBe(180);
    expect(restDay.protein).toBe(180);
  });
});

describe("matchFlexTreat", () => {
  it("matches a requested treat and computes both balancing options", () => {
    const result = matchFlexTreat("I really want pizza this weekend", "omnivore");
    expect(result).not.toBeNull();
    expect(result!.treat.name).toContain("Pizza");
    expect(result!.dailyTrimCalories).toBe(Math.round(520 / 6));
  });

  it("returns null for carnivore regardless of match", () => {
    expect(matchFlexTreat("pizza", "carnivore")).toBeNull();
  });

  it("returns null when nothing in the text matches the treat database", () => {
    expect(matchFlexTreat("chicken and rice", "omnivore")).toBeNull();
  });
});

describe("buildMealSpecs", () => {
  it("splits macros across meals so the parts sum back to the whole", () => {
    const macros = { calories: 2200, protein: 181, carbs: 200, fats: 61 };
    const specs = buildMealSpecs(macros, 4, true);
    expect(specs).toHaveLength(5); // 4 meals + snack
    const totalProtein = specs.reduce((sum, s) => sum + s.proteinTarget, 0);
    const totalCarbs = specs.reduce((sum, s) => sum + s.carbsTarget, 0);
    const totalFats = specs.reduce((sum, s) => sum + s.fatTarget, 0);
    expect(totalProtein).toBe(macros.protein);
    expect(totalCarbs).toBe(macros.carbs);
    expect(totalFats).toBe(macros.fats);
  });

  it("labels the first meal breakfast and the last dinner", () => {
    const specs = buildMealSpecs({ calories: 2000, protein: 150, carbs: 150, fats: 60 }, 3, false);
    expect(specs[0].slot).toBe("breakfast");
    expect(specs[specs.length - 1].slot).toBe("dinner");
    expect(specs).toHaveLength(3);
  });
});

describe("generateMealOptions", () => {
  const context = {
    archetype: "omnivore" as const,
    bioScores: { strength: 4, recovery: 4, digestion: 5, satiety: 4 },
    phase: "fat_loss" as const,
    dietaryRestrictions: "",
    favoriteFoods: "",
  };

  it("returns up to 3 recipe options matching the slot and archetype", () => {
    const specs = buildMealSpecs({ calories: 2200, protein: 180, carbs: 200, fats: 60 }, 4, false);
    const breakfast = generateMealOptions(specs[0], { calories: 2200, protein: 180, carbs: 200, fats: 60 }, context);
    expect(breakfast.options.length).toBeGreaterThan(0);
    expect(breakfast.options.length).toBeLessThanOrEqual(3);
    expect(breakfast.options[0].ingredients.length).toBeGreaterThan(0);
  });

  it("excludes recipes matching a banned keyword", () => {
    const specs = buildMealSpecs({ calories: 2200, protein: 180, carbs: 200, fats: 60 }, 4, false);
    const restrictedContext = { ...context, dietaryRestrictions: "no eggs" };
    const breakfast = generateMealOptions(specs[0], { calories: 2200, protein: 180, carbs: 200, fats: 60 }, restrictedContext);
    const hasEggRecipe = breakfast.options.some((o) => o.recipeId.includes("egg"));
    expect(hasEggRecipe).toBe(false);
  });

  it("respects a vegan archetype — no animal-product recipes returned", () => {
    const veganContext = { ...context, archetype: "vegan" as const };
    const specs = buildMealSpecs({ calories: 2000, protein: 150, carbs: 200, fats: 60 }, 3, false);
    for (const spec of specs) {
      const meal = generateMealOptions(spec, { calories: 2000, protein: 150, carbs: 200, fats: 60 }, veganContext);
      for (const opt of meal.options) {
        const recipe = opt.recipeId;
        expect(recipe.startsWith("b_carnivore") || recipe.startsWith("l_carnivore") || recipe.startsWith("d_carnivore")).toBe(false);
      }
    }
  });
});
