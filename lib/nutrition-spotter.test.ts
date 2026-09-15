import { describe, it, expect } from "vitest";
import { detectStaleMealPlan, extractPlanCalories } from "./nutrition-spotter";

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
