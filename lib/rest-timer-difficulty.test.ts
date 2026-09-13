import { describe, expect, it } from "vitest";
import { computeDifficultyProgress, computeDifficultyMultiplier, MIN_REST_SECONDS_FOR_GAME } from "./rest-timer-difficulty";

describe("computeDifficultyProgress", () => {
  it("is 0 at the very start", () => {
    expect(computeDifficultyProgress(0, 90000)).toBe(0);
  });

  it("is 1 at the hard cutoff", () => {
    expect(computeDifficultyProgress(90000, 90000)).toBe(1);
  });

  it("clamps at 1 past the cutoff, never exceeding it", () => {
    expect(computeDifficultyProgress(120000, 90000)).toBe(1);
  });

  it("is a fraction partway through", () => {
    expect(computeDifficultyProgress(45000, 90000)).toBe(0.5);
  });

  it("treats a zero/negative duration as already at the cutoff, not a divide-by-zero", () => {
    expect(computeDifficultyProgress(1000, 0)).toBe(1);
  });
});

describe("computeDifficultyMultiplier", () => {
  it("equals the start value at progress 0", () => {
    expect(computeDifficultyMultiplier(0, 1, 3)).toBe(1);
  });

  it("equals the max value at progress 1", () => {
    expect(computeDifficultyMultiplier(1, 1, 3)).toBe(3);
  });

  it("eases in -- less than halfway to max at the 50% progress mark", () => {
    const half = computeDifficultyMultiplier(0.5, 1, 3);
    const linearHalf = 1 + (3 - 1) * 0.5; // 2
    expect(half).toBeLessThan(linearHalf);
  });

  it("is monotonically increasing across the whole range", () => {
    const values = [0, 0.25, 0.5, 0.75, 1].map((p) => computeDifficultyMultiplier(p, 1, 3));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

describe("MIN_REST_SECONDS_FOR_GAME", () => {
  it("is the resolved 45-second threshold", () => {
    expect(MIN_REST_SECONDS_FOR_GAME).toBe(45);
  });
});
