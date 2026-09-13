import { describe, expect, it } from "vitest";
import { computeSafeGoalRate, DEFAULT_SAFE_RATE_PCT_PER_WEEK, MAX_SAFE_RATE_PCT_PER_WEEK } from "./safe-goal-rate";

describe("computeSafeGoalRate — within safe range", () => {
  it("is not capped when the requested rate is under the general ceiling", () => {
    // 200 -> 190 over 20 weeks = 5% total / 20 weeks = 0.25%/week
    const result = computeSafeGoalRate({
      currentWeight: 200,
      targetWeight: 190,
      weeksRemaining: 20,
      isCompetitionPrep: false,
    });
    expect(result.wasCapped).toBe(false);
    expect(result.requestedRatePctPerWeek).toBeCloseTo(-0.25, 2);
    expect(result.recommendedRatePctPerWeek).toBeCloseTo(-0.25, 2);
    expect(result.disclaimer).toBeNull();
  });

  it("preserves a positive sign for a gain goal", () => {
    const result = computeSafeGoalRate({
      currentWeight: 150,
      targetWeight: 153,
      weeksRemaining: 10,
      isCompetitionPrep: false,
    });
    expect(result.requestedRatePctPerWeek).toBeGreaterThan(0);
  });
});

describe("computeSafeGoalRate — exceeds the general 0.7%/week ceiling", () => {
  it("caps to 0.7%/week and returns a real disclaimer", () => {
    // 200 -> 180 over 10 weeks = 10% total / 10 weeks = 1%/week — over the cap
    const result = computeSafeGoalRate({
      currentWeight: 200,
      targetWeight: 180,
      weeksRemaining: 10,
      isCompetitionPrep: false,
    });
    expect(result.wasCapped).toBe(true);
    expect(result.requestedRatePctPerWeek).toBeCloseTo(-1, 2);
    expect(result.recommendedRatePctPerWeek).toBeCloseTo(-MAX_SAFE_RATE_PCT_PER_WEEK, 2);
    expect(result.disclaimer).not.toBeNull();
  });
});

describe("computeSafeGoalRate — competition prep uses the tighter 0.5%/week cap", () => {
  it("caps at 0.5%/week even when the general cap would have allowed more", () => {
    // 0.6%/week — under the general 0.7 cap, but over the competition-prep 0.5 cap
    const result = computeSafeGoalRate({
      currentWeight: 200,
      targetWeight: 194,
      weeksRemaining: 5,
      isCompetitionPrep: true,
    });
    expect(result.wasCapped).toBe(true);
    expect(result.recommendedRatePctPerWeek).toBeCloseTo(-DEFAULT_SAFE_RATE_PCT_PER_WEEK, 2);
  });

  it("is not capped when already under the tighter competition-prep ceiling", () => {
    const result = computeSafeGoalRate({
      currentWeight: 200,
      targetWeight: 196,
      weeksRemaining: 10,
      isCompetitionPrep: true,
    });
    expect(result.wasCapped).toBe(false);
  });
});
