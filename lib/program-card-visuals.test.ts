import { describe, expect, it } from "vitest";
import {
  parseNumericReps,
  computeWeeklyVolumeSeries,
  bucketCategorySplit,
  buildSparklinePath,
} from "./program-card-visuals";

describe("parseNumericReps", () => {
  it("parses a plain number", () => {
    expect(parseNumericReps("8")).toBe(8);
  });
  it("rejects a range or tag", () => {
    expect(parseNumericReps("8-10")).toBeNull();
    expect(parseNumericReps("AMRAP")).toBeNull();
  });
  it("handles null/empty", () => {
    expect(parseNumericReps(null)).toBeNull();
    expect(parseNumericReps("")).toBeNull();
  });
});

describe("computeWeeklyVolumeSeries", () => {
  it("indexes both series to week 1 = 100", () => {
    const planned = new Map([[1, 1000], [2, 1200]]);
    const actual = new Map([[1, 900]]);
    const series = computeWeeklyVolumeSeries(planned, actual, 2);
    expect(series[0]).toEqual({ week: 1, plannedIndexed: 100, actualIndexed: 90 });
    expect(series[1]).toEqual({ week: 2, plannedIndexed: 120, actualIndexed: null });
  });

  it("leaves actual null for an un-logged week instead of a fake zero", () => {
    const planned = new Map([[1, 1000]]);
    const actual = new Map<number, number>();
    const series = computeWeeklyVolumeSeries(planned, actual, 1);
    expect(series[0].actualIndexed).toBeNull();
  });

  it("handles a zero week-1 planned baseline without dividing by zero", () => {
    const planned = new Map<number, number>();
    const actual = new Map([[1, 500]]);
    const series = computeWeeklyVolumeSeries(planned, actual, 1);
    expect(series[0].plannedIndexed).toBe(0);
    expect(series[0].actualIndexed).toBe(0);
  });
});

describe("bucketCategorySplit", () => {
  it("applies the confirmed mapping (Push/Pull->Upper, Legs->Lower, rest->Conditioning)", () => {
    const split = bucketCategorySplit({ Push: 5, Pull: 4, Legs: 9, Core: 1, Cardio: 1 });
    // upper=9, lower=9, conditioning=2, total=20
    expect(split).toEqual({ upper: 45, lower: 45, conditioning: 10 });
  });

  it("sums to exactly 100 despite rounding", () => {
    const split = bucketCategorySplit({ Push: 1, Legs: 1, Cardio: 1 });
    expect(split.upper + split.lower + split.conditioning).toBe(100);
  });

  it("falls back to 100% conditioning with no categorized exercises", () => {
    expect(bucketCategorySplit({})).toEqual({ upper: 0, lower: 0, conditioning: 100 });
  });
});

describe("buildSparklinePath", () => {
  it("builds a continuous path with no gaps", () => {
    const result = buildSparklinePath([100, 110, 120], 100, 60);
    expect(result.linePath).toMatch(/^M /);
    expect(result.areaPath).not.toBeNull();
    expect(result.points).toHaveLength(3);
    expect(result.points.every((p) => p !== null)).toBe(true);
  });

  it("breaks into a new subpath after a gap and returns no area fill", () => {
    const result = buildSparklinePath([100, null, 120], 100, 60);
    const moveCommands = (result.linePath.match(/M/g) ?? []).length;
    expect(moveCommands).toBe(2);
    expect(result.areaPath).toBeNull();
    expect(result.points[1]).toBeNull();
  });

  it("draws no area fill for a lone single point (e.g. a one-week program)", () => {
    // A real bug caught live: a single point closed back through the
    // bottom corners drew a misleading wedge that looked like a decline.
    const result = buildSparklinePath([100], 100, 60);
    expect(result.areaPath).toBeNull();
  });

  it("uses a shared explicit range so two series stay comparable", () => {
    const a = buildSparklinePath([100, 100], 100, 60, { min: 0, max: 200 });
    const b = buildSparklinePath([100, 100], 100, 60, { min: 0, max: 200 });
    expect(a.points).toEqual(b.points);
  });
});
