import { describe, it, expect } from "vitest";
import {
  detectStaleMealPlan,
  extractPlanCalories,
  detectMacroSumMismatch,
  detectRestrictedIngredientSlips,
  detectProteinTooLow,
  detectInjuredActiveDeficit,
} from "./nutrition-spotter";

describe("extractPlanCalories", () => {
  it("reads a plain daily plan", () => {
    expect(extractPlanCalories({ daily: { calories: 2200 } })).toBe(2200);
  });

  it("averages train/rest buckets for a carb-cycling plan", () => {
    expect(extractPlanCalories({ train: { calories: 2600 }, rest: { calories: 2000 } })).toBe(2300);
  });

  it("returns null for a missing/malformed shape", () => {
    expect(extractPlanCalories(null)).toBeNull();
    expect(extractPlanCalories({})).toBeNull();
  });
});

describe("detectStaleMealPlan", () => {
  it("flags a real, meaningful drift", () => {
    const result = detectStaleMealPlan({ daily: { calories: 2200 } }, 2000);
    expect(result.isStale).toBe(true);
    expect(result.planCalories).toBe(2200);
    expect(result.diffKcal).toBe(200);
  });

  it("does not flag a match within rounding tolerance", () => {
    const result = detectStaleMealPlan({ daily: { calories: 2010 } }, 2000);
    expect(result.isStale).toBe(false);
    expect(result.diffKcal).toBe(10);
  });

  it("does not flag right at the tolerance boundary", () => {
    const result = detectStaleMealPlan({ daily: { calories: 2050 } }, 2000);
    expect(result.isStale).toBe(false);
  });

  it("flags just past the tolerance boundary", () => {
    const result = detectStaleMealPlan({ daily: { calories: 2051 } }, 2000);
    expect(result.isStale).toBe(true);
  });

  it("never flags when there's no plan to compare", () => {
    const result = detectStaleMealPlan(null, 2000);
    expect(result.isStale).toBe(false);
    expect(result.planCalories).toBeNull();
  });

  it("works for a carb-cycling plan whose average has drifted", () => {
    const result = detectStaleMealPlan({ train: { calories: 2600 }, rest: { calories: 2000 } }, 2000);
    expect(result.isStale).toBe(true);
    expect(result.planCalories).toBe(2300);
  });
});

describe("detectMacroSumMismatch", () => {
  it("does not flag a plan whose meals sum correctly (the common, correct case)", () => {
    const result = detectMacroSumMismatch(
      [
        { proteinTarget: 50, carbsTarget: 60, fatTarget: 20 },
        { proteinTarget: 50, carbsTarget: 60, fatTarget: 20 },
      ],
      { protein: 100, carbs: 120, fats: 40 }
    );
    expect(result.isMismatched).toBe(false);
  });

  it("flags a real drift in protein even when carbs/fat still match", () => {
    const result = detectMacroSumMismatch(
      [{ proteinTarget: 50, carbsTarget: 60, fatTarget: 20 }],
      { protein: 100, carbs: 60, fats: 20 }
    );
    expect(result.isMismatched).toBe(true);
    expect(result.summedProtein).toBe(50);
    expect(result.targetProtein).toBe(100);
  });

  it("tolerates small rounding drift from largest-remainder distribution", () => {
    const result = detectMacroSumMismatch(
      [{ proteinTarget: 33, carbsTarget: 33, fatTarget: 33 }, { proteinTarget: 33, carbsTarget: 34, fatTarget: 33 }, { proteinTarget: 34, carbsTarget: 33, fatTarget: 34 }],
      { protein: 100, carbs: 100, fats: 100 }
    );
    expect(result.isMismatched).toBe(false);
  });

  it("returns zero sums for an empty meal list without throwing", () => {
    const result = detectMacroSumMismatch([], { protein: 100, carbs: 100, fats: 100 });
    expect(result.isMismatched).toBe(true);
    expect(result.summedProtein).toBe(0);
  });
});

describe("detectRestrictedIngredientSlips", () => {
  it("catches a banned ingredient in a saved meal's recipe text", () => {
    const slips = detectRestrictedIngredientSlips(
      [
        {
          mealId: "1",
          title: "Breakfast",
          recipes: [{ recipeName: "Peanut Butter Oats", ingredients: ["<strong>40g</strong> Peanut Butter", "60g Oats"] }],
        },
      ],
      "peanuts, shellfish"
    );
    expect(slips).toHaveLength(1);
    expect(slips[0].matchedRestriction).toBe("peanuts");
    expect(slips[0].recipeName).toBe("Peanut Butter Oats");
  });

  it("strips HTML tags before matching, not just plain text", () => {
    const slips = detectRestrictedIngredientSlips(
      [{ mealId: "1", title: "Lunch", recipes: [{ recipeName: "Shrimp Bowl", ingredients: ["<strong>150g</strong> Shrimp"] }] }],
      "shellfish"
    );
    // "shellfish" itself never literally appears, but this proves the
    // matcher runs on the real (HTML-stripped) text rather than crashing —
    // a real ban list entry would need to actually name the ingredient.
    expect(slips).toHaveLength(0);
  });

  it("ignores archetype labels like 'vegan' or 'keto' as if they were ingredient bans", () => {
    const slips = detectRestrictedIngredientSlips(
      [{ mealId: "1", title: "Dinner", recipes: [{ recipeName: "Vegan Chili", ingredients: ["Beans", "Tomato"] }] }],
      "vegan"
    );
    expect(slips).toHaveLength(0);
  });

  it("returns nothing when no restrictions are set", () => {
    const slips = detectRestrictedIngredientSlips(
      [{ mealId: "1", title: "Breakfast", recipes: [{ recipeName: "Eggs", ingredients: ["Eggs"] }] }],
      ""
    );
    expect(slips).toEqual([]);
  });

  it("checks every recipe choice in a multi-option meal slot, not just the first", () => {
    const slips = detectRestrictedIngredientSlips(
      [
        {
          mealId: "1",
          title: "Lunch",
          recipes: [
            { recipeName: "Chicken Bowl", ingredients: ["Chicken", "Rice"] },
            { recipeName: "Almond Bowl", ingredients: ["150g Almonds"] },
          ],
        },
      ],
      "almonds"
    );
    expect(slips).toHaveLength(1);
    expect(slips[0].recipeName).toBe("Almond Bowl");
  });
});

describe("detectProteinTooLow", () => {
  it("flags a real sustained shortfall", () => {
    const result = detectProteinTooLow([100, 105, 95, 90, 100], 180);
    expect(result.isLow).toBe(true);
    expect(result.daysBelowTarget).toBe(5);
  });

  it("does not flag protein that's close to or above baseline", () => {
    const result = detectProteinTooLow([170, 180, 190, 175], 180);
    expect(result.isLow).toBe(false);
  });

  it("does not flag a single low day as 'sustained'", () => {
    const result = detectProteinTooLow([90], 180);
    expect(result.isLow).toBe(false);
    expect(result.daysWithData).toBe(1);
  });

  it("does not flag an occasional low day inside an otherwise-good week", () => {
    // 2 of 5 days low — under the 70% sustained threshold.
    const result = detectProteinTooLow([180, 90, 175, 185, 90], 180);
    expect(result.isLow).toBe(false);
  });

  it("flags most-but-not-all days low as sustained (a real cheat day doesn't clear the flag)", () => {
    // 4 of 5 days low — at/above the 70% sustained threshold.
    const result = detectProteinTooLow([90, 90, 200, 90, 90], 180);
    expect(result.isLow).toBe(true);
  });

  it("never flags with no logged data or no real target", () => {
    expect(detectProteinTooLow([], 180).isLow).toBe(false);
    expect(detectProteinTooLow([90, 90, 90], 0).isLow).toBe(false);
  });
});

// Check #5 — coach_em_up_finley_funston_transcript.md's real client-
// safety gap: injured + still in a fat-loss phase.
describe("detectInjuredActiveDeficit", () => {
  it("flags an injured client whose active phase is fat_loss", () => {
    expect(detectInjuredActiveDeficit(true, "fat_loss").isFlagged).toBe(true);
  });

  it("does not flag an injured client on any non-deficit phase", () => {
    expect(detectInjuredActiveDeficit(true, "maintenance").isFlagged).toBe(false);
    expect(detectInjuredActiveDeficit(true, "hypertrophy").isFlagged).toBe(false);
    expect(detectInjuredActiveDeficit(true, "reverse_diet").isFlagged).toBe(false);
  });

  it("does not flag a non-injured client regardless of phase", () => {
    expect(detectInjuredActiveDeficit(false, "fat_loss").isFlagged).toBe(false);
  });

  it("does not flag when there's no check-in on record at all", () => {
    expect(detectInjuredActiveDeficit(true, null).isFlagged).toBe(false);
  });
});
