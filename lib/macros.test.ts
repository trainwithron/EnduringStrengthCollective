import { describe, it, expect } from "vitest";
import {
  estimateProteinFromBodyWeight,
  fillCarbsAndFat,
  estimateMaintenanceCalories,
  applyGoalAdjustment,
  detectDietArchetype,
  computeArchetypeMacros,
} from "./macros";

describe("estimateProteinFromBodyWeight", () => {
  it("uses the 1g-per-lb rule of thumb", () => {
    expect(estimateProteinFromBodyWeight(180)).toBe(180);
  });
});

describe("fillCarbsAndFat", () => {
  it("splits remaining calories 70/30 (carb/fat) on a high-carb day", () => {
    // 2400 cal, 180g protein -> 720 protein cal, 1680 remaining.
    const result = fillCarbsAndFat(2400, 180, "high");
    expect(result).toEqual({ carbsG: 294, fatG: 56 });
  });

  it("splits remaining calories 30/70 (carb/fat) on a low-carb day", () => {
    const result = fillCarbsAndFat(2400, 180, "low");
    expect(result).toEqual({ carbsG: 126, fatG: 131 });
  });

  it("splits remaining calories 50/50 (carb/fat) on a balanced day", () => {
    const result = fillCarbsAndFat(2400, 180, "balanced");
    expect(result).toEqual({ carbsG: 210, fatG: 93 });
  });

  it("returns null when there's nothing to split", () => {
    expect(fillCarbsAndFat(0, 180, "high")).toBeNull();
    expect(fillCarbsAndFat(2400, 0, "high")).toBeNull();
    // Protein alone already meets/exceeds calories — nothing left over.
    expect(fillCarbsAndFat(400, 180, "high")).toBeNull();
  });
});

describe("estimateMaintenanceCalories", () => {
  it("uses a bodyweight-multiplier estimate keyed to activity level", () => {
    expect(estimateMaintenanceCalories(180, "sedentary")).toBe(2160);
    expect(estimateMaintenanceCalories(180, "light")).toBe(2520);
    expect(estimateMaintenanceCalories(180, "moderate")).toBe(2880);
    expect(estimateMaintenanceCalories(180, "very_active")).toBe(3240);
  });
});

describe("applyGoalAdjustment", () => {
  it("cuts 20% off maintenance for a cut", () => {
    expect(applyGoalAdjustment(2500, "cut")).toBe(2000);
  });

  it("leaves maintenance unchanged for maintain", () => {
    expect(applyGoalAdjustment(2500, "maintain")).toBe(2500);
  });

  it("adds 10% for a lean bulk", () => {
    expect(applyGoalAdjustment(2500, "lean_bulk")).toBe(2750);
  });
});

describe("detectDietArchetype", () => {
  it("detects carnivore from either phrasing", () => {
    expect(detectDietArchetype("Carnivore diet")).toBe("carnivore");
    expect(detectDietArchetype("prefers zero carb")).toBe("carnivore");
  });

  it("detects keto", () => {
    expect(detectDietArchetype("strict keto")).toBe("keto");
  });

  it("falls back to standard for anything else, including vegan/vegetarian/paleo", () => {
    expect(detectDietArchetype("vegan")).toBe("standard");
    expect(detectDietArchetype("vegetarian, no shellfish")).toBe("standard");
    expect(detectDietArchetype("paleo")).toBe("standard");
    expect(detectDietArchetype(null)).toBe("standard");
    expect(detectDietArchetype("")).toBe("standard");
  });
});

describe("computeArchetypeMacros", () => {
  it("computes the standard split with both floors respected", () => {
    const result = computeArchetypeMacros(2000, 180, "standard");
    expect(result).toEqual({ proteinG: 180, carbsG: 194, fatG: 56, resolvedCalories: 2000 });
  });

  it("fixes carbs at 25g for keto, filling fat with the remainder", () => {
    const result = computeArchetypeMacros(2000, 180, "keto");
    expect(result).toEqual({ proteinG: 180, carbsG: 25, fatG: 131, resolvedCalories: 1999 });
  });

  it("zeroes carbs for carnivore, filling fat with the remainder", () => {
    const result = computeArchetypeMacros(2000, 180, "carnivore");
    expect(result).toEqual({ proteinG: 180, carbsG: 0, fatG: 142, resolvedCalories: 1998 });
  });

  it("respects the 45g fat floor and 50g carb floor even at very low calories", () => {
    const result = computeArchetypeMacros(1200, 220, "standard");
    expect(result.fatG).toBeGreaterThanOrEqual(45);
    expect(result.carbsG).toBeGreaterThanOrEqual(50);
  });
});
