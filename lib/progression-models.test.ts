import { describe, it, expect } from "vitest";
import {
  roundToIncrement,
  generateLinearProgression,
  generateDoubleProgression,
  generateUndulatingProgression,
  DEFAULT_UNDULATING_WAVE,
} from "./progression-models";

describe("roundToIncrement", () => {
  it("rounds to the nearest 2.5 by default", () => {
    expect(roundToIncrement(137.8)).toBe(137.5);
    expect(roundToIncrement(136.3)).toBe(137.5);
  });
});

describe("generateLinearProgression", () => {
  it("compounds weight by a fixed percentage each week", () => {
    const result = generateLinearProgression(
      { weight: 200, reps: 8, repMin: null, repMax: null },
      { weeks: 3, weightPctIncreasePerWeek: 5 }
    );
    // 200 -> 210 -> 220 -> 231 (rounded to nearest 2.5 each step)
    expect(result.map((r) => r.weight)).toEqual([210, 220, 230]);
    expect(result.every((r) => r.reps === 8)).toBe(true);
  });

  it("cycles a rep sequence across generated weeks while weight keeps compounding", () => {
    const result = generateLinearProgression(
      { weight: 100, reps: 5, repMin: null, repMax: null },
      { weeks: 5, weightPctIncreasePerWeek: 0, repCycle: [5, 8, 12] }
    );
    expect(result.map((r) => r.reps)).toEqual([5, 8, 12, 5, 8]);
  });

  it("leaves weight null when the source has no weight (bodyweight exercise)", () => {
    const result = generateLinearProgression(
      { weight: null, reps: 10, repMin: null, repMax: null },
      { weeks: 2, weightPctIncreasePerWeek: 5 }
    );
    expect(result.every((r) => r.weight === null)).toBe(true);
  });
});

describe("generateDoubleProgression", () => {
  it("adds a rep each week until hitting the ceiling, then resets and bumps weight", () => {
    const result = generateDoubleProgression(
      { weight: 100, reps: 8, repMin: 8, repMax: 10 },
      { weeks: 4, weightBumpPct: 5 }
    );
    // wk1: 8->9, wk2: 9->10, wk3: at ceiling -> reset to 8, weight 100->105, wk4: 8->9
    expect(result.map((r) => r.reps)).toEqual([9, 10, 8, 9]);
    expect(result.map((r) => r.weight)).toEqual([100, 100, 105, 105]);
  });

  it("does nothing (carries forward unchanged) without a real rep range", () => {
    const result = generateDoubleProgression(
      { weight: 100, reps: 8, repMin: null, repMax: null },
      { weeks: 3, weightBumpPct: 5 }
    );
    expect(result.every((r) => r.reps === 8 && r.weight === 100)).toBe(true);
  });
});

describe("generateUndulatingProgression", () => {
  it("applies the default heavy/moderate/light wave and repeats it, leaving weight unchanged", () => {
    const result = generateUndulatingProgression(
      { weight: 200, reps: 10, repMin: null, repMax: null },
      { weeks: 6, wave: DEFAULT_UNDULATING_WAVE }
    );
    expect(result.every((r) => r.weight === 200)).toBe(true);
    expect(result.map((r) => r.reps)).toEqual([5, 8, 12, 5, 8, 12]);
  });

  it("uses the reps typed in for each stage directly, ignoring the source reps entirely", () => {
    const result = generateUndulatingProgression(
      { weight: 100, reps: 999, repMin: null, repMax: null },
      { weeks: 1, wave: [{ reps: 6 }] }
    );
    expect(result[0].reps).toBe(6);
  });
});
