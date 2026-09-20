import { describe, expect, it } from "vitest";
import {
  computeCoachRankingScore,
  computeDifficultyWeight,
  computeDistanceScore,
  computeNormalizedGoalFitScore,
  computeWeightedWilsonLowerBound,
  DEFAULT_RANKING_WEIGHTS,
  hasReliableOutcomeSignal,
  type ClientOutcomeCase,
} from "./marketplace-coach-ranking";

describe("hasReliableOutcomeSignal", () => {
  it("is true only for weight_loss and endurance_event", () => {
    expect(hasReliableOutcomeSignal("weight_loss")).toBe(true);
    expect(hasReliableOutcomeSignal("endurance_event")).toBe(true);
    expect(hasReliableOutcomeSignal("powerbuilding_strongman")).toBe(false);
    expect(hasReliableOutcomeSignal("muscle_gain")).toBe(false);
    expect(hasReliableOutcomeSignal("bodybuilding")).toBe(false);
    expect(hasReliableOutcomeSignal("body_recomp")).toBe(false);
    expect(hasReliableOutcomeSignal("custom")).toBe(false);
  });
});

describe("computeDistanceScore", () => {
  it("returns 1 at zero distance", () => {
    expect(computeDistanceScore(0)).toBe(1);
  });

  it("returns 0.5 at exactly d0", () => {
    expect(computeDistanceScore(5, 5)).toBeCloseTo(0.5, 5);
  });

  it("decays monotonically as distance increases", () => {
    const near = computeDistanceScore(2);
    const mid = computeDistanceScore(10);
    const far = computeDistanceScore(50);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });
});

describe("computeNormalizedGoalFitScore", () => {
  it("returns 0 when the coach has zero programs", () => {
    expect(computeNormalizedGoalFitScore({}, 0, "weight_loss")).toBe(0);
  });

  it("normalizes the raw match count by total program count", () => {
    // weight_loss maps to Conditioning/Endurance + General Fitness
    const score = computeNormalizedGoalFitScore(
      { "Conditioning/Endurance": 3, "General Fitness": 2 },
      10,
      "weight_loss"
    );
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("clamps at 1 even if matches exceed total (shouldn't happen, but stay safe)", () => {
    const score = computeNormalizedGoalFitScore({ Hypertrophy: 20 }, 5, "muscle_gain");
    expect(score).toBe(1);
  });
});

describe("computeDifficultyWeight", () => {
  it("returns 1 (baseline) when there's no target date", () => {
    expect(computeDifficultyWeight("2026-01-01", null)).toBe(1);
  });

  it("weights an aggressive (short) timeline higher than baseline", () => {
    // 84-day baseline; a 21-day timeline is 4x more aggressive
    const w = computeDifficultyWeight("2026-01-01", "2026-01-22");
    expect(w).toBeGreaterThan(1);
  });

  it("weights a generous (long) timeline lower than baseline", () => {
    const w = computeDifficultyWeight("2026-01-01", "2027-01-01");
    expect(w).toBeLessThan(1);
  });

  it("clamps at the upper bound for an extremely short timeline", () => {
    const w = computeDifficultyWeight("2026-01-01", "2026-01-02");
    expect(w).toBe(2.5);
  });

  it("clamps at the lower bound for an extremely long timeline", () => {
    const w = computeDifficultyWeight("2026-01-01", "2030-01-01");
    expect(w).toBe(0.5);
  });

  it("treats a target date at or before creation as maximally difficult", () => {
    expect(computeDifficultyWeight("2026-01-01", "2026-01-01")).toBe(2.5);
    expect(computeDifficultyWeight("2026-01-01", "2025-12-01")).toBe(2.5);
  });
});

describe("computeWeightedWilsonLowerBound", () => {
  it("returns null for zero cases (undefined, not zero)", () => {
    expect(computeWeightedWilsonLowerBound([])).toBeNull();
  });

  it("returns a lower bound below the raw proportion for a small sample", () => {
    const cases: ClientOutcomeCase[] = [
      { clientId: "a", success: true, goalCreatedAt: "2026-01-01", targetDate: "2026-04-01" },
      { clientId: "b", success: true, goalCreatedAt: "2026-01-01", targetDate: "2026-04-01" },
      { clientId: "c", success: false, goalCreatedAt: "2026-01-01", targetDate: "2026-04-01" },
    ];
    const bound = computeWeightedWilsonLowerBound(cases)!;
    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThan(2 / 3);
  });

  it("gives a higher score to all-successes than a mixed sample of the same size", () => {
    const allSuccess: ClientOutcomeCase[] = Array.from({ length: 5 }, (_, i) => ({
      clientId: `s${i}`,
      success: true,
      goalCreatedAt: "2026-01-01",
      targetDate: "2026-04-01",
    }));
    const mixed: ClientOutcomeCase[] = [
      ...allSuccess.slice(0, 3),
      { clientId: "f1", success: false, goalCreatedAt: "2026-01-01", targetDate: "2026-04-01" },
      { clientId: "f2", success: false, goalCreatedAt: "2026-01-01", targetDate: "2026-04-01" },
    ];
    expect(computeWeightedWilsonLowerBound(allSuccess)!).toBeGreaterThan(computeWeightedWilsonLowerBound(mixed)!);
  });

  it("rewards a coach who succeeds on a genuinely harder (short-timeline) case more than an easy one", () => {
    const hardSuccess: ClientOutcomeCase[] = [
      { clientId: "hard", success: true, goalCreatedAt: "2026-01-01", targetDate: "2026-01-22" }, // aggressive
    ];
    const easySuccess: ClientOutcomeCase[] = [
      { clientId: "easy", success: true, goalCreatedAt: "2026-01-01", targetDate: "2027-01-01" }, // generous
    ];
    // Both are single-case 100% success, so raw p is identical (1.0) —
    // the difficulty weighting shows up in effective sample size
    // (a harder single success counts for more confidence), not in a
    // different point estimate for a single homogeneous case. Confirm
    // via a mixed comparison instead: one hard success plus one easy
    // failure should score higher than one easy success plus one hard
    // failure, since the hard case's success/failure should carry more
    // weight than the easy case's in the opposite direction.
    const hardSucceedsEasyFails: ClientOutcomeCase[] = [
      { clientId: "hard-win", success: true, goalCreatedAt: "2026-01-01", targetDate: "2026-01-22" },
      { clientId: "easy-loss", success: false, goalCreatedAt: "2026-01-01", targetDate: "2027-01-01" },
    ];
    const easySucceedsHardFails: ClientOutcomeCase[] = [
      { clientId: "easy-win", success: true, goalCreatedAt: "2026-01-01", targetDate: "2027-01-01" },
      { clientId: "hard-loss", success: false, goalCreatedAt: "2026-01-01", targetDate: "2026-01-22" },
    ];
    expect(computeWeightedWilsonLowerBound(hardSucceedsEasyFails)!).toBeGreaterThan(
      computeWeightedWilsonLowerBound(easySucceedsHardFails)!
    );
    // Sanity: both single-case scenarios above are still well-formed
    // (non-null, in range).
    expect(computeWeightedWilsonLowerBound(hardSuccess)).not.toBeNull();
    expect(computeWeightedWilsonLowerBound(easySuccess)).not.toBeNull();
  });
});

describe("computeCoachRankingScore", () => {
  const baseInput = {
    distanceMiles: 5,
    intentCounts: { "Conditioning/Endurance": 4, "General Fitness": 2 } as const,
    totalProgramCount: 10,
    weights: DEFAULT_RANKING_WEIGHTS,
  };

  it("uses the full 3-way weighted blend when real outcome cases exist", () => {
    const result = computeCoachRankingScore({
      ...baseInput,
      goalType: "weight_loss",
      outcomeCases: [
        { clientId: "a", success: true, goalCreatedAt: "2026-01-01", targetDate: "2026-04-01" },
        { clientId: "b", success: true, goalCreatedAt: "2026-01-01", targetDate: "2026-04-01" },
      ],
    });
    expect(result.outcomeScore).not.toBeNull();
    expect(result.weightsUsed).toEqual(DEFAULT_RANKING_WEIGHTS);
    expect(result.score).toBeGreaterThan(0);
  });

  it("drops the outcome factor and re-normalizes for a goal type with no reliable signal", () => {
    const result = computeCoachRankingScore({
      ...baseInput,
      goalType: "powerbuilding_strongman",
      outcomeCases: [],
    });
    expect(result.outcomeScore).toBeNull();
    expect(result.weightsUsed.outcome).toBe(0);
    expect(result.weightsUsed.distance + result.weightsUsed.goalFit).toBeCloseTo(1, 5);
    // Re-normalized proportionally: 0.3/(0.3+0.3) = 0.5 each
    expect(result.weightsUsed.distance).toBeCloseTo(0.5, 5);
    expect(result.weightsUsed.goalFit).toBeCloseTo(0.5, 5);
  });

  it("drops the outcome factor for n=0 outside the boost window", () => {
    const result = computeCoachRankingScore({
      ...baseInput,
      goalType: "weight_loss",
      outcomeCases: [],
      isInNewlyVerifiedBoostWindow: false,
    });
    expect(result.outcomeScore).toBeNull();
    expect(result.weightsUsed.outcome).toBe(0);
  });

  it("substitutes the platform average for n=0 inside the boost window", () => {
    const result = computeCoachRankingScore({
      ...baseInput,
      goalType: "endurance_event",
      outcomeCases: [],
      isInNewlyVerifiedBoostWindow: true,
      platformAverageOutcomeScore: 0.42,
    });
    expect(result.outcomeScore).toBe(0.42);
    expect(result.weightsUsed).toEqual(DEFAULT_RANKING_WEIGHTS);
  });

  it("still drops outcome inside the boost window if no platform average is available", () => {
    const result = computeCoachRankingScore({
      ...baseInput,
      goalType: "endurance_event",
      outcomeCases: [],
      isInNewlyVerifiedBoostWindow: true,
      platformAverageOutcomeScore: null,
    });
    expect(result.outcomeScore).toBeNull();
  });

  it("defaults to DEFAULT_RANKING_WEIGHTS when no weights are passed", () => {
    const result = computeCoachRankingScore({
      distanceMiles: 5,
      intentCounts: {},
      totalProgramCount: 0,
      goalType: "custom",
      outcomeCases: [],
    });
    expect(result.weightsUsed.distance).toBeCloseTo(0.5, 5);
    expect(result.weightsUsed.goalFit).toBeCloseTo(0.5, 5);
  });
});
