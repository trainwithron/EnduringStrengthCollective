import { describe, it, expect } from "vitest";
import {
  getWeekDates,
  getDatesForWeekdays,
  mergeMealIntoPlan,
  mealRecipeChoices,
  type MealEntryPayload,
} from "./meal-plan-assignment";

describe("getWeekDates", () => {
  it("returns the Sun..Sat week containing the anchor date", () => {
    // 2026-09-07 is a Monday.
    const week = getWeekDates("2026-09-07");
    expect(week).toEqual([
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });

  it("handles an anchor that's already a Sunday", () => {
    const week = getWeekDates("2026-09-06");
    expect(week[0]).toBe("2026-09-06");
    expect(week[6]).toBe("2026-09-12");
  });

  it("spans a month boundary correctly", () => {
    // 2026-09-30 is a Wednesday; that week runs into October.
    const week = getWeekDates("2026-09-30");
    expect(week).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });
});

describe("getDatesForWeekdays", () => {
  it("maps requested weekday numbers to real dates in order requested", () => {
    // Mon/Wed/Fri for the week containing 2026-09-07 (a Monday).
    const dates = getDatesForWeekdays("2026-09-07", [1, 3, 5]);
    expect(dates).toEqual(["2026-09-07", "2026-09-09", "2026-09-11"]);
  });

  it("supports Tue/Thu/Sat", () => {
    const dates = getDatesForWeekdays("2026-09-07", [2, 4, 6]);
    expect(dates).toEqual(["2026-09-08", "2026-09-10", "2026-09-12"]);
  });
});

describe("mergeMealIntoPlan", () => {
  const chickenRice: MealEntryPayload = {
    mealId: "2",
    title: "Midday Meal 1",
    proteinTarget: 38,
    carbsTarget: 50,
    fatTarget: 13,
    recipeId: "l_chicken_rice",
    recipeName: "Chicken Breast & Jasmine Rice Bowl",
    ingredients: ["Chicken Breast: 148g"],
  };
  const beefPotato: MealEntryPayload = {
    mealId: "2",
    title: "Midday Meal 1",
    proteinTarget: 38,
    carbsTarget: 50,
    fatTarget: 13,
    recipeId: "d_beef_potato",
    recipeName: "Beef & Sweet Potato",
    ingredients: ["Ground Beef: 160g"],
  };
  const fallback = {
    archetype: "omnivore",
    mealCount: 4,
    includeSnack: true,
    carbCycling: false,
    macros: { daily: { calories: 2200, protein: 180, carbs: 200, fats: 60 } },
  };

  it("creates a brand-new day with just the assigned meal when nothing existed", () => {
    const result = mergeMealIntoPlan(null, "daily", chickenRice, fallback);
    expect(result.meals.daily).toEqual([chickenRice]);
    expect(result.archetype).toBe("omnivore");
    expect(result.macros).toEqual(fallback.macros);
  });

  it("replaces only the matching meal slot, leaving other slots on that day untouched", () => {
    const breakfast: MealEntryPayload = { ...chickenRice, mealId: "1", title: "Breakfast", recipeName: "Oatmeal" };
    const existing = mergeMealIntoPlan(null, "daily", breakfast, fallback);
    const result = mergeMealIntoPlan(existing, "daily", chickenRice, fallback);
    expect(result.meals.daily).toHaveLength(2);
    expect(result.meals.daily.find((m) => m.mealId === "1")?.recipeName).toBe("Oatmeal");
    expect(result.meals.daily.find((m) => m.mealId === "2")?.recipeName).toBe("Chicken Breast & Jasmine Rice Bowl");
  });

  it("overwrites a previously-assigned recipe for the same meal slot", () => {
    const withChicken = mergeMealIntoPlan(null, "daily", chickenRice, fallback);
    const withBeef = mergeMealIntoPlan(withChicken, "daily", beefPotato, fallback);
    expect(withBeef.meals.daily).toHaveLength(1);
    expect(withBeef.meals.daily[0].recipeName).toBe("Beef & Sweet Potato");
  });

  it("leaves other buckets (train/rest) alone when only one is targeted", () => {
    const existing: import("./meal-plan-assignment").MealPlanRow = {
      archetype: "omnivore",
      meal_count: 4,
      include_snack: true,
      carb_cycling: true,
      rationale: null,
      macros: { train: { calories: 2600, protein: 180, carbs: 300, fats: 60 }, rest: { calories: 2000, protein: 180, carbs: 150, fats: 60 } },
      meals: { train: [chickenRice], rest: [beefPotato] },
    };
    const result = mergeMealIntoPlan(existing, "rest", chickenRice, fallback);
    expect(result.meals.train).toEqual([chickenRice]);
    expect(result.meals.rest[0].recipeName).toBe("Chicken Breast & Jasmine Rice Bowl");
  });

  it("stores multiple recipe choices for one meal slot at once", () => {
    const breakfastChoices: MealEntryPayload = {
      mealId: "1",
      title: "Breakfast",
      proteinTarget: 30,
      carbsTarget: 40,
      fatTarget: 15,
      recipes: [
        { recipeId: "eggs_scramble", recipeName: "Pasture Eggs & Sourdough Scramble", ingredients: ["Eggs: 3"] },
        { recipeId: "yogurt_rice", recipeName: "Greek Yogurt & Cream of Rice", ingredients: ["Greek Yogurt: 200g"] },
      ],
    };
    const result = mergeMealIntoPlan(null, "daily", breakfastChoices, fallback);
    expect(result.meals.daily[0].recipes).toHaveLength(2);
  });
});

describe("mealRecipeChoices", () => {
  it("returns the recipes array directly when present", () => {
    const entry: MealEntryPayload = {
      mealId: "1",
      title: "Breakfast",
      proteinTarget: 30,
      carbsTarget: 40,
      fatTarget: 15,
      recipes: [
        { recipeId: "a", recipeName: "Option A", ingredients: [] },
        { recipeId: "b", recipeName: "Option B", ingredients: [] },
      ],
    };
    expect(mealRecipeChoices(entry)).toHaveLength(2);
  });

  it("falls back to the legacy singular fields when recipes is absent", () => {
    const entry: MealEntryPayload = {
      mealId: "1",
      title: "Breakfast",
      proteinTarget: 30,
      carbsTarget: 40,
      fatTarget: 15,
      recipeId: "l_oatmeal",
      recipeName: "Oatmeal",
      ingredients: ["Oats: 60g"],
    };
    expect(mealRecipeChoices(entry)).toEqual([
      { recipeId: "l_oatmeal", recipeName: "Oatmeal", ingredients: ["Oats: 60g"] },
    ]);
  });

  it("returns an empty list when neither shape has anything", () => {
    const entry: MealEntryPayload = {
      mealId: "1",
      title: "Breakfast",
      proteinTarget: 30,
      carbsTarget: 40,
      fatTarget: 15,
    };
    expect(mealRecipeChoices(entry)).toEqual([]);
  });
});
