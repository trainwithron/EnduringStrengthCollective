import { describe, it, expect } from "vitest";
import { estimateTrainingMaxFromSet } from "./rpe-training-max";

describe("estimateTrainingMaxFromSet", () => {
  it("matches plain Epley when RPE is a true 10 (zero reps in reserve)", () => {
    // Epley: weight * (1 + reps/30) = 225 * (1 + 5/30) = 262.5
    expect(estimateTrainingMaxFromSet(225, 5, 10)).toBe(262.5);
  });

  it("estimates a higher max for the same set logged at a lower RPE", () => {
    const atRpe10 = estimateTrainingMaxFromSet(225, 5, 10)!;
    const atRpe8 = estimateTrainingMaxFromSet(225, 5, 8)!;
    expect(atRpe8).toBeGreaterThan(atRpe10);
  });

  it("computes the RPE-adjusted estimate correctly (2 reps in reserve at RPE 8)", () => {
    // effective reps = 5 + (10-8) = 7 -> 225 * (1 + 7/30) = 277.5
    expect(estimateTrainingMaxFromSet(225, 5, 8)).toBe(277.5);
  });

  it("returns null for a non-positive weight, reps, or rpe", () => {
    expect(estimateTrainingMaxFromSet(0, 5, 8)).toBeNull();
    expect(estimateTrainingMaxFromSet(225, 0, 8)).toBeNull();
    expect(estimateTrainingMaxFromSet(225, 5, 0)).toBeNull();
  });

  it("never lets RPE above 10 imply negative reps in reserve", () => {
    // A logging quirk (rpe > 10) should clamp to the same result as RPE 10.
    expect(estimateTrainingMaxFromSet(225, 5, 11)).toBe(estimateTrainingMaxFromSet(225, 5, 10));
  });
});
