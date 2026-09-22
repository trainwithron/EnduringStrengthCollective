import { describe, it, expect } from "vitest";
import { computeSessionLoad, computeAverageSessionRpe, computeWeeklyTrainingLoad } from "./session-rpe";

describe("computeSessionLoad", () => {
  it("multiplies RPE by duration in minutes", () => {
    // 7 RPE * 60 min = 420 AU
    expect(computeSessionLoad(7, 3600)).toBe(420);
  });

  it("rounds a fractional minute count", () => {
    // 5 RPE * 45.5 min = 227.5 -> rounds to 228
    expect(computeSessionLoad(5, 2730)).toBe(228);
  });

  it("returns 0 for a zero-duration session", () => {
    expect(computeSessionLoad(8, 0)).toBe(0);
  });
});

describe("computeAverageSessionRpe", () => {
  it("averages a set of ratings", () => {
    expect(computeAverageSessionRpe([6, 8, 7])).toBeCloseTo(7);
  });

  it("returns null for an empty list rather than NaN", () => {
    expect(computeAverageSessionRpe([])).toBeNull();
  });

  it("handles a single value", () => {
    expect(computeAverageSessionRpe([9])).toBe(9);
  });
});

describe("computeWeeklyTrainingLoad", () => {
  it("zero-fills every week in range, oldest to newest", () => {
    const buckets = computeWeeklyTrainingLoad([], "2026-09-21", 4);
    expect(buckets).toHaveLength(4);
    expect(buckets.every((b) => b.load === 0)).toBe(true);
  });

  it("sums load for rows landing in the correct week", () => {
    // 2026-09-21 is a Monday; its week starts Sunday 2026-09-20.
    const rows = [
      { sessionRpe: 6, durationSeconds: 3600, createdAtDateKey: "2026-09-21" }, // load 360, this week
      { sessionRpe: 8, durationSeconds: 1800, createdAtDateKey: "2026-09-13" }, // load 240, prior week
    ];
    const buckets = computeWeeklyTrainingLoad(rows, "2026-09-21", 2);
    expect(buckets[1].load).toBe(360); // current week (last bucket)
    expect(buckets[0].load).toBe(240); // prior week
  });

  it("excludes a row that falls outside the requested window", () => {
    const rows = [{ sessionRpe: 10, durationSeconds: 3600, createdAtDateKey: "2026-06-01" }];
    const buckets = computeWeeklyTrainingLoad(rows, "2026-09-21", 2);
    expect(buckets.every((b) => b.load === 0)).toBe(true);
  });
});
