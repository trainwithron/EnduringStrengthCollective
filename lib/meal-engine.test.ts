import { describe, it, expect } from "vitest";
import {
  computeCheckIn,
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

describe("computeCheckIn", () => {
  it("holds macros steady when adherence was under 5/7 days", () => {
    const result = computeCheckIn({
      phase: "fat_loss",
      currentWeight: 180,
      previousWeight: 182,
      currentCalories: 2200,
      adherenceDays: 3,
      rateStrength: 4,
      rateRecovery: 4,
      rateDigestion: 5,
      rateSatiety: 4,
      dietaryRestrictions: "",
    });
    // newAvgCalories must always agree with dailyBaseline.calories — the
    // actual number a coach/client is shown as "the target." Macro-gram
    // rounding (see the dedicated test below for the floor-clamp case)
    // means this isn't always the exact pre-rounding intermediate value.
    expect(result.newAvgCalories).toBe(result.dailyBaseline.calories);
    expect(result.newAvgCalories).toBeCloseTo(2200, -1);
    expect(result.rationale).toContain("adherence");
  });

  it("keeps newAvgCalories in sync with dailyBaseline.calories even when the carb/fat floor clamps push the real target above the intermediate one", () => {
    // A low enough target that the Math.max(50, ...) carb floor and
    // Math.max(45, ...) fat floor both kick in — previously the rationale
    // and newAvgCalories would still describe the pre-clamp number
    // (900 kcal) while the client's actual macro targets resolved to a
    // meaningfully higher real total.
    const result = computeCheckIn({
      phase: "fat_loss",
      currentWeight: 100,
      previousWeight: 100,
      currentCalories: 900,
      adherenceDays: 2, // under 5 -> "held steady" branch, newAvgCals = currC exactly
      rateStrength: 4,
      rateRecovery: 4,
      rateDigestion: 5,
      rateSatiety: 4,
      dietaryRestrictions: "",
    });
    expect(result.dailyBaseline.protein).toBe(100);
    expect(result.dailyBaseline.fats).toBe(45); // clamped up from the raw ~25g
    expect(result.dailyBaseline.carbs).toBe(50); // clamped up from the raw ~24g
    expect(result.dailyBaseline.calories).toBe(1005); // 400 + 200 + 405, not 900
    expect(result.newAvgCalories).toBe(result.dailyBaseline.calories);
  });

  it("drops calories 8% on a stalled fat-loss week with good recovery", () => {
    const result = computeCheckIn({
      phase: "fat_loss",
      currentWeight: 182,
      previousWeight: 182,
      currentCalories: 2200,
      adherenceDays: 7,
      rateStrength: 4,
      rateRecovery: 4,
      rateDigestion: 5,
      rateSatiety: 4,
      dietaryRestrictions: "",
    });
    expect(result.newAvgCalories).toBe(Math.round(2200 * 0.92));
  });

  it("applies a 175 kcal bump when weight drops during a hypertrophy phase", () => {
    const result = computeCheckIn({
      phase: "hypertrophy",
      currentWeight: 178,
      previousWeight: 180,
      currentCalories: 2800,
      adherenceDays: 7,
      rateStrength: 4,
      rateRecovery: 4,
      rateDigestion: 5,
      rateSatiety: 4,
      dietaryRestrictions: "",
    });
    expect(result.newAvgCalories).toBe(2975);
  });

  it("holds surplus steady on the first spike, then trims on the second consecutive one", () => {
    const first = computeCheckIn({
      phase: "hypertrophy",
      currentWeight: 183,
      previousWeight: 180,
      currentCalories: 2800,
      adherenceDays: 7,
      rateStrength: 4,
      rateRecovery: 4,
      rateDigestion: 5,
      rateSatiety: 4,
      dietaryRestrictions: "",
      consecutiveSurplusSpikes: 0,
    });
    expect(first.newAvgCalories).toBe(first.dailyBaseline.calories);
    expect(first.newAvgCalories).toBeCloseTo(2800, -1);
    expect(first.consecutiveSurplusSpikes).toBe(1);

    const second = computeCheckIn({
      phase: "hypertrophy",
      currentWeight: 183,
      previousWeight: 180,
      currentCalories: 2800,
      adherenceDays: 7,
      rateStrength: 4,
      rateRecovery: 4,
      rateDigestion: 5,
      rateSatiety: 4,
      dietaryRestrictions: "",
      consecutiveSurplusSpikes: first.consecutiveSurplusSpikes,
    });
    expect(second.newAvgCalories).toBe(second.dailyBaseline.calories);
    expect(second.newAvgCalories).toBeCloseTo(2675, -1);
    expect(second.consecutiveSurplusSpikes).toBe(0);
  });

  it("zeroes carbs for carnivore and fixes carbs at 25g for keto", () => {
    const carnivore = computeCheckIn({
      phase: "maintenance",
      currentWeight: 180,
      previousWeight: 180,
      currentCalories: 2400,
      adherenceDays: 7,
      rateStrength: 4,
      rateRecovery: 4,
      rateDigestion: 5,
      rateSatiety: 4,
      dietaryRestrictions: "carnivore",
    });
    expect(carnivore.dailyBaseline.carbs).toBe(0);
    expect(carnivore.dailyBaseline.protein).toBe(180);

    const keto = computeCheckIn({
      phase: "maintenance",
      currentWeight: 180,
      previousWeight: 180,
      currentCalories: 2400,
      adherenceDays: 7,
      rateStrength: 4,
      rateRecovery: 4,
      rateDigestion: 5,
      rateSatiety: 4,
      dietaryRestrictions: "keto",
    });
    expect(keto.dailyBaseline.carbs).toBe(25);
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
