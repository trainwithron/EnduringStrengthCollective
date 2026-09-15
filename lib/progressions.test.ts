import { describe, it, expect } from "vitest";
import { resolveProgressionTarget } from "./progressions";

describe("resolveProgressionTarget", () => {
  it("returns null weight/reps for the reference occurrence (index 1)", () => {
    const result = resolveProgressionTarget({
      model: "linear",
      config: { weightIncrement: 5, repIncrement: 0, unit: "lbs" },
      occurrenceIndex: 1,
      referenceLog: { weight: 200, reps: 5 },
      previousOccurrenceLog: null,
    });
    expect(result).toEqual({ weight: null, reps: null });
  });

  describe("linear model", () => {
    it("adds a fixed weight increment per elapsed step", () => {
      const result = resolveProgressionTarget({
        model: "linear",
        config: { weightIncrement: 5, repIncrement: 0, unit: "lbs" },
        occurrenceIndex: 3,
        referenceLog: { weight: 200, reps: 5 },
        previousOccurrenceLog: null,
      });
      expect(result).toEqual({ weight: 210, reps: 5 });
    });

    it("applies a percentage increment relative to the reference weight", () => {
      const result = resolveProgressionTarget({
        model: "linear",
        config: { weightIncrement: 5, repIncrement: 0, unit: "percent" },
        occurrenceIndex: 2,
        referenceLog: { weight: 200, reps: 5 },
        previousOccurrenceLog: null,
      });
      expect(result).toEqual({ weight: 210, reps: 5 });
    });

    it("also steps reps when repIncrement is set", () => {
      const result = resolveProgressionTarget({
        model: "linear",
        config: { weightIncrement: 0, repIncrement: 1, unit: "lbs" },
        occurrenceIndex: 4,
        referenceLog: { weight: 100, reps: 5 },
        previousOccurrenceLog: null,
      });
      expect(result).toEqual({ weight: 100, reps: 8 });
    });

    it("returns nulls with no reference log to progress from", () => {
      const result = resolveProgressionTarget({
        model: "linear",
        config: { weightIncrement: 5, repIncrement: 0, unit: "lbs" },
        occurrenceIndex: 3,
        referenceLog: null,
        previousOccurrenceLog: null,
      });
      expect(result).toEqual({ weight: null, reps: null });
    });
  });

  describe("wave model", () => {
    const config = {
      weightDeltas: [0, -10, 10],
      repsPattern: [5, 8, 12],
      unit: "lbs" as const,
    };

    it("cycles weight deltas and rep pattern by occurrence index", () => {
      const occurrence2 = resolveProgressionTarget({
        model: "wave",
        config,
        occurrenceIndex: 2,
        referenceLog: { weight: 200, reps: 5 },
        previousOccurrenceLog: null,
      });
      expect(occurrence2).toEqual({ weight: 190, reps: 8 });
    });

    it("wraps back to the start of the pattern once it's exhausted", () => {
      const occurrence4 = resolveProgressionTarget({
        model: "wave",
        config,
        occurrenceIndex: 4,
        referenceLog: { weight: 200, reps: 5 },
        previousOccurrenceLog: null,
      });
      expect(occurrence4).toEqual({ weight: 200, reps: 5 });
    });

    it("falls back to the reference log directly when no pattern is configured", () => {
      const result = resolveProgressionTarget({
        model: "wave",
        config: { weightDeltas: [], repsPattern: [], unit: "lbs" },
        occurrenceIndex: 2,
        referenceLog: { weight: 200, reps: 5 },
        previousOccurrenceLog: null,
      });
      expect(result).toEqual({ weight: 200, reps: 5 });
    });
  });

  describe("double_progression model", () => {
    const config = { repRangeLow: 5, repRangeHigh: 8, weightIncrement: 5, unit: "lbs" as const };

    it("bumps weight and resets reps to the range floor once the ceiling is hit", () => {
      const result = resolveProgressionTarget({
        model: "double_progression",
        config,
        occurrenceIndex: 2,
        referenceLog: null,
        previousOccurrenceLog: { weight: 200, reps: 8 },
      });
      expect(result).toEqual({ weight: 205, reps: 5 });
    });

    it("adds one rep and holds weight while still under the ceiling", () => {
      const result = resolveProgressionTarget({
        model: "double_progression",
        config,
        occurrenceIndex: 2,
        referenceLog: null,
        previousOccurrenceLog: { weight: 200, reps: 6 },
      });
      expect(result).toEqual({ weight: 200, reps: 7 });
    });

    it("never proposes reps above the range ceiling", () => {
      const result = resolveProgressionTarget({
        model: "double_progression",
        config,
        occurrenceIndex: 2,
        referenceLog: null,
        previousOccurrenceLog: { weight: 200, reps: 7 },
      });
      expect(result.reps).toBeLessThanOrEqual(config.repRangeHigh);
    });

    it("returns nulls with no previous occurrence log to progress from", () => {
      const result = resolveProgressionTarget({
        model: "double_progression",
        config,
        occurrenceIndex: 2,
        referenceLog: { weight: 200, reps: 5 },
        previousOccurrenceLog: null,
      });
      expect(result).toEqual({ weight: null, reps: null });
    });
  });

  // dup_gzclp_build_spec_sept15.md, step 1 of the build order — proves
  // GZCLP's T2 and T3 tiers are expressible through the EXISTING
  // double_progression model via config alone (a degenerate 10/10 range
  // for T2, a real 15/25 range for T3), zero new code. Validates the
  // spec's central claim before any GZCLP-specific code (T1's new
  // progression model) gets built.
  describe("double_progression config as GZCLP T2 (fixed 3x10, gate on hitting the target)", () => {
    const t2Config = { repRangeLow: 10, repRangeHigh: 10, weightIncrement: 5, unit: "lbs" as const };

    it("bumps weight once all 3 sets hit the 10-rep target", () => {
      const result = resolveProgressionTarget({
        model: "double_progression",
        config: t2Config,
        occurrenceIndex: 2,
        referenceLog: null,
        previousOccurrenceLog: { weight: 135, reps: 10 },
      });
      expect(result).toEqual({ weight: 140, reps: 10 });
    });

    it("never targets more than 10 reps — a degenerate range can't climb", () => {
      const result = resolveProgressionTarget({
        model: "double_progression",
        config: t2Config,
        occurrenceIndex: 2,
        referenceLog: null,
        previousOccurrenceLog: { weight: 135, reps: 10 },
      });
      expect(result.reps).toBe(10);
    });
  });

  describe("double_progression config as GZCLP T3 (AMRAP 3x15+, climb reps to 25 before bumping weight)", () => {
    const t3Config = { repRangeLow: 15, repRangeHigh: 25, weightIncrement: 10, unit: "lbs" as const };

    it("holds weight and climbs reps by 1 while under the 25-rep ceiling", () => {
      const result = resolveProgressionTarget({
        model: "double_progression",
        config: t3Config,
        occurrenceIndex: 2,
        referenceLog: null,
        previousOccurrenceLog: { weight: 95, reps: 18 },
      });
      expect(result).toEqual({ weight: 95, reps: 19 });
    });

    it("bumps weight and resets to 15 once the AMRAP set reaches 25", () => {
      const result = resolveProgressionTarget({
        model: "double_progression",
        config: t3Config,
        occurrenceIndex: 2,
        referenceLog: null,
        previousOccurrenceLog: { weight: 95, reps: 25 },
      });
      expect(result).toEqual({ weight: 105, reps: 15 });
    });
  });

  it("returns nulls for an unrecognized model", () => {
    const result = resolveProgressionTarget({
      model: "unknown" as any,
      config: { weightIncrement: 5, repIncrement: 0, unit: "lbs" },
      occurrenceIndex: 2,
      referenceLog: { weight: 200, reps: 5 },
      previousOccurrenceLog: null,
    });
    expect(result).toEqual({ weight: null, reps: null });
  });
});
