import { describe, it, expect } from "vitest";
import { computeReadinessAverage, isLowReadiness, LOW_READINESS_THRESHOLD } from "./wellness";

describe("computeReadinessAverage", () => {
  it("averages the three fields", () => {
    expect(computeReadinessAverage({ sleepQuality: 4, soreness: 2, energy: 3 })).toBeCloseTo(3);
  });

  it("handles the extremes", () => {
    expect(computeReadinessAverage({ sleepQuality: 1, soreness: 1, energy: 1 })).toBe(1);
    expect(computeReadinessAverage({ sleepQuality: 5, soreness: 5, energy: 5 })).toBe(5);
  });
});

describe("isLowReadiness", () => {
  it("does not flag an exact-threshold average", () => {
    expect(isLowReadiness({ sleepQuality: 3, soreness: 3, energy: 3 })).toBe(false);
    expect(computeReadinessAverage({ sleepQuality: 3, soreness: 3, energy: 3 })).toBe(LOW_READINESS_THRESHOLD);
  });

  it("flags an average just below the threshold", () => {
    expect(isLowReadiness({ sleepQuality: 3, soreness: 3, energy: 2 })).toBe(true);
  });

  it("flags the worst case and never flags the best case", () => {
    expect(isLowReadiness({ sleepQuality: 1, soreness: 1, energy: 1 })).toBe(true);
    expect(isLowReadiness({ sleepQuality: 5, soreness: 5, energy: 5 })).toBe(false);
  });
});
