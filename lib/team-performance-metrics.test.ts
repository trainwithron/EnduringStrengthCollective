import { describe, it, expect } from "vitest";
import { computeDailyAverageReadiness, computeWeeklyActivity } from "./team-performance-metrics";

describe("computeDailyAverageReadiness", () => {
  it("averages multiple athletes' check-ins on the same day", () => {
    const result = computeDailyAverageReadiness([
      { logDate: "2026-09-10", sleepQuality: 4, soreness: 4, energy: 4 }, // avg 4
      { logDate: "2026-09-10", sleepQuality: 2, soreness: 2, energy: 2 }, // avg 2
      { logDate: "2026-09-11", sleepQuality: 5, soreness: 5, energy: 5 }, // avg 5
    ]);
    expect(result).toEqual([
      { date: "2026-09-10", value: 3 },
      { date: "2026-09-11", value: 5 },
    ]);
  });

  it("sorts by date ascending regardless of input order", () => {
    const result = computeDailyAverageReadiness([
      { logDate: "2026-09-11", sleepQuality: 3, soreness: 3, energy: 3 },
      { logDate: "2026-09-09", sleepQuality: 3, soreness: 3, energy: 3 },
    ]);
    expect(result.map((r) => r.date)).toEqual(["2026-09-09", "2026-09-11"]);
  });

  it("returns an empty array for no rows", () => {
    expect(computeDailyAverageReadiness([])).toEqual([]);
  });
});

describe("computeWeeklyActivity", () => {
  it("zero-fills a week with no logged workouts", () => {
    // asOf is a Thursday; one log two weeks back, nothing in between.
    const result = computeWeeklyActivity(["2026-08-27"], "2026-09-10", 3);
    expect(result).toHaveLength(3);
    expect(result.map((b) => b.count)).toEqual([1, 0, 0]);
  });

  it("counts every log within its correct week, oldest to newest", () => {
    const result = computeWeeklyActivity(
      ["2026-09-08", "2026-09-09", "2026-09-01"],
      "2026-09-10",
      2
    );
    // Week 1 (older) gets the Sep 1 log; week 2 (current, containing
    // asOf) gets the two Sep 8/9 logs.
    expect(result.map((b) => b.count)).toEqual([1, 2]);
  });

  it("returns all-zero buckets for an empty input", () => {
    const result = computeWeeklyActivity([], "2026-09-10", 4);
    expect(result.every((b) => b.count === 0)).toBe(true);
    expect(result).toHaveLength(4);
  });
});
