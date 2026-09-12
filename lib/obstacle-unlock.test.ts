import { describe, it, expect } from "vitest";
import {
  computePriorBest,
  isGenuinePr,
  meetsPrescribedTarget,
  isObstacleCleared,
  isExerciseUnlocked,
} from "./obstacle-unlock";

describe("computePriorBest", () => {
  it("finds the max weight, max reps, and max single-set volume independently", () => {
    const prior = computePriorBest([
      { weight: 100, reps: 5 }, // volume 500
      { weight: 80, reps: 12 }, // volume 960 — highest volume, not highest weight or reps alone
      { weight: 120, reps: 3 }, // highest weight
    ]);
    expect(prior).toEqual({ maxWeight: 120, maxReps: 12, maxVolume: 960 });
  });

  it("ignores incomplete rows and returns all-null for empty history", () => {
    expect(computePriorBest([{ weight: null, reps: 5 }, { weight: 100, reps: null }])).toEqual({
      maxWeight: null,
      maxReps: null,
      maxVolume: null,
    });
    expect(computePriorBest([])).toEqual({ maxWeight: null, maxReps: null, maxVolume: null });
  });
});

describe("isGenuinePr", () => {
  it("qualifies on a weight PR alone", () => {
    expect(isGenuinePr(105, 5, { maxWeight: 100, maxReps: 10, maxVolume: 10000 })).toBe(true);
  });

  it("qualifies on a rep PR alone, even at a lower weight", () => {
    expect(isGenuinePr(50, 15, { maxWeight: 200, maxReps: 12, maxVolume: 5000 })).toBe(true);
  });

  it("qualifies on a volume PR alone, even without a weight or rep PR", () => {
    // 90*9 = 810, beats maxVolume 800, but neither weight nor reps alone are new
    expect(isGenuinePr(90, 9, { maxWeight: 100, maxReps: 10, maxVolume: 800 })).toBe(true);
  });

  it("does not qualify when nothing beats prior best on any of the three", () => {
    expect(isGenuinePr(90, 8, { maxWeight: 100, maxReps: 10, maxVolume: 1000 })).toBe(false);
  });

  it("qualifies unconditionally with no prior history at all (first-ever set)", () => {
    expect(isGenuinePr(45, 5, { maxWeight: null, maxReps: null, maxVolume: null })).toBe(true);
  });
});

describe("meetsPrescribedTarget", () => {
  it("clears when both weight and reps are at or above target", () => {
    expect(meetsPrescribedTarget(100, 5, 100, 5)).toBe(true);
    expect(meetsPrescribedTarget(105, 6, 100, 5)).toBe(true);
  });

  it("does not clear when either falls short", () => {
    expect(meetsPrescribedTarget(100, 4, 100, 5)).toBe(false); // Ron's own example: 100x4 against a 100x5 goal
    expect(meetsPrescribedTarget(95, 5, 100, 5)).toBe(false);
  });

  it("never applies with no target set (freeform logging)", () => {
    expect(meetsPrescribedTarget(999, 999, null, 5)).toBe(false);
    expect(meetsPrescribedTarget(999, 999, 100, null)).toBe(false);
  });
});

describe("isObstacleCleared", () => {
  it("clears via the target path even with no PR", () => {
    expect(isObstacleCleared(100, 5, 100, 5, { maxWeight: 150, maxReps: 20, maxVolume: 3000 })).toBe(
      true
    );
  });

  it("clears via the PR path even below the prescribed target", () => {
    // Program target is 150x5, but 120 is a genuine all-time weight PR
    expect(isObstacleCleared(120, 5, 150, 5, { maxWeight: 100, maxReps: 10, maxVolume: 1000 })).toBe(
      true
    );
  });

  it("a genuinely new but unproven below-target result unlocks nothing", () => {
    // 100x4 against a 100x5 goal, and 100x4 has never been done before either
    expect(isObstacleCleared(100, 4, 100, 5, { maxWeight: 100, maxReps: 5, maxVolume: 500 })).toBe(
      false
    );
  });

  it("returns false when either actual value is missing (set not yet logged)", () => {
    expect(isObstacleCleared(null, 5, 100, 5, { maxWeight: null, maxReps: null, maxVolume: null })).toBe(
      false
    );
    expect(isObstacleCleared(100, null, 100, 5, { maxWeight: null, maxReps: null, maxVolume: null })).toBe(
      false
    );
  });
});

describe("isExerciseUnlocked", () => {
  it("unlocks the whole exercise once any single set clears it", () => {
    const prior = { maxWeight: 100, maxReps: 10, maxVolume: 1000 };
    const sets = [
      { weight: 90, reps: 5, targetWeight: 100, targetReps: 5 }, // miss
      { weight: 100, reps: 5, targetWeight: 100, targetReps: 5 }, // clears
      { weight: null, reps: null, targetWeight: 100, targetReps: 5 }, // not yet logged
    ];
    expect(isExerciseUnlocked(sets, prior)).toBe(true);
  });

  it("stays locked when every set so far is a miss or unlogged", () => {
    const prior = { maxWeight: 100, maxReps: 10, maxVolume: 1000 };
    const sets = [
      { weight: 90, reps: 5, targetWeight: 100, targetReps: 5 },
      { weight: null, reps: null, targetWeight: 100, targetReps: 5 },
    ];
    expect(isExerciseUnlocked(sets, prior)).toBe(false);
  });

  it("an exercise with no sets at all is not unlocked", () => {
    expect(isExerciseUnlocked([], { maxWeight: null, maxReps: null, maxVolume: null })).toBe(false);
  });
});
