import { describe, it, expect } from "vitest";
import { formatCondensedSets } from "./exercise-fields";

function set(overrides: Partial<{ targetReps: string | null; targetTimeSeconds: number | null; targetDistance: number | null; targetHeight: number | null }> = {}) {
  return { targetReps: null, targetTimeSeconds: null, targetDistance: null, targetHeight: null, ...overrides };
}

describe("formatCondensedSets", () => {
  it("formats reps-tracked sets as setsxreps", () => {
    const sets = [set({ targetReps: "8" }), set({ targetReps: "8" })];
    expect(formatCondensedSets(sets, ["reps", "weight"])).toBe("2×8");
  });

  it("formats time-tracked sets with a seconds suffix", () => {
    const sets = [set({ targetTimeSeconds: 30 }), set({ targetTimeSeconds: 30 }), set({ targetTimeSeconds: 30 })];
    expect(formatCondensedSets(sets, ["time"])).toBe("3×30s");
  });

  it("falls back to a plain set count when the primary field has no value yet", () => {
    const sets = [set(), set()];
    expect(formatCondensedSets(sets, ["reps", "weight"])).toBe("2 sets");
  });

  it("returns a plain set count for an exercise with no sets", () => {
    expect(formatCondensedSets([], ["reps"])).toBe("0 sets");
  });

  it("prefers reps over time when both are tracked and reps is set", () => {
    const sets = [set({ targetReps: "5", targetTimeSeconds: 60 })];
    expect(formatCondensedSets(sets, ["reps", "time"])).toBe("1×5");
  });
});
