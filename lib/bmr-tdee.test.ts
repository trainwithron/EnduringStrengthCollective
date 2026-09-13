import { describe, expect, it } from "vitest";
import {
  computeMifflinStJeorBmr,
  computeKatchMcArdleBmr,
  computeBmr,
  activityCategoryFromSteps,
  computeTdee,
} from "./bmr-tdee";

describe("computeMifflinStJeorBmr", () => {
  it("matches the published formula for a male", () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(computeMifflinStJeorBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male" })).toBe(1780);
  });

  it("matches the published formula for a female", () => {
    // 10*80 + 6.25*180 - 5*30 - 161 = 800 + 1125 - 150 - 161 = 1614
    expect(computeMifflinStJeorBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "female" })).toBe(1614);
  });
});

describe("computeKatchMcArdleBmr", () => {
  it("matches the published formula", () => {
    // leanMass = 80 * 0.85 = 68; BMR = 370 + 21.6*68 = 1838.8
    expect(computeKatchMcArdleBmr({ weightKg: 80, bodyFatPct: 15 })).toBeCloseTo(1838.8, 1);
  });
});

describe("computeBmr", () => {
  it("uses Mifflin-St Jeor when no body-fat % is on file", () => {
    const result = computeBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male", bodyFatPct: null });
    expect(result).toBe(1780);
  });

  it("automatically switches to Katch-McArdle the moment a real body-fat % exists", () => {
    const result = computeBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male", bodyFatPct: 15 });
    expect(result).toBeCloseTo(1838.8, 1);
  });
});

describe("activityCategoryFromSteps", () => {
  it("categorizes across every real band boundary", () => {
    expect(activityCategoryFromSteps(3000)).toBe("sedentary");
    expect(activityCategoryFromSteps(4999)).toBe("sedentary");
    expect(activityCategoryFromSteps(5000)).toBe("light");
    expect(activityCategoryFromSteps(7499)).toBe("light");
    expect(activityCategoryFromSteps(7500)).toBe("moderate");
    expect(activityCategoryFromSteps(9999)).toBe("moderate");
    expect(activityCategoryFromSteps(10000)).toBe("active");
    expect(activityCategoryFromSteps(12499)).toBe("active");
    expect(activityCategoryFromSteps(12500)).toBe("very_active");
    expect(activityCategoryFromSteps(20000)).toBe("very_active");
  });
});

describe("computeTdee", () => {
  it("applies the correct multiplier per category", () => {
    expect(computeTdee(1780, "sedentary")).toBe(Math.round(1780 * 1.2));
    expect(computeTdee(1780, "very_active")).toBe(Math.round(1780 * 1.9));
  });
});
