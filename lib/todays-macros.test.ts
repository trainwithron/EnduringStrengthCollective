import { describe, it, expect } from "vitest";
import { resolveDayMacroTarget } from "./todays-macros";

describe("resolveDayMacroTarget", () => {
  it("prefers the meal plan's macros when a meal plan with assigned meals exists", () => {
    const result = resolveDayMacroTarget(
      { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 },
      { daily: { calories: 2400, protein: 180, carbs: 250, fats: 70 } },
      { daily: [{ mealId: "breakfast" }] }
    );
    expect(result).toEqual({ calories: 2400, proteinG: 180, carbsG: 250, fatG: 70 });
  });

  it("picks the carb-cycling bucket that actually has meals assigned, not just the first key", () => {
    const result = resolveDayMacroTarget(
      null,
      { train: { calories: 2800, protein: 180, carbs: 300, fats: 60 }, rest: { calories: 2200, protein: 180, carbs: 150, fats: 70 } },
      { train: [], rest: [{ mealId: "breakfast" }] }
    );
    expect(result).toEqual({ calories: 2200, proteinG: 180, carbsG: 150, fatG: 70 });
  });

  it("falls back to daily_macros when no meal plan exists for the day", () => {
    const result = resolveDayMacroTarget(
      { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 },
      null,
      null
    );
    expect(result).toEqual({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
  });

  it("falls back to daily_macros when the meal plan's macros are missing/empty", () => {
    const result = resolveDayMacroTarget(
      { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 },
      {},
      { daily: [{ mealId: "breakfast" }] }
    );
    expect(result).toEqual({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
  });

  it("returns null when neither source has anything", () => {
    expect(resolveDayMacroTarget(null, null, null)).toBeNull();
  });
});
