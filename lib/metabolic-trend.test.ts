import { describe, it, expect } from "vitest";
import { computeWindowedAverage, computeReverseDietMilestone } from "./metabolic-trend";

describe("computeWindowedAverage", () => {
  it("averages values within the window", () => {
    const rows = [
      { date: "2026-09-01", value: 10 },
      { date: "2026-09-02", value: 20 },
      { date: "2026-09-03", value: 30 },
    ];
    const result = computeWindowedAverage(rows, new Date("2026-09-01"), new Date("2026-09-03"));
    expect(result).toBe(20);
  });

  it("ignores rows outside the window", () => {
    const rows = [
      { date: "2026-08-31", value: 999 },
      { date: "2026-09-01", value: 10 },
      { date: "2026-09-02", value: 20 },
      { date: "2026-09-04", value: 999 },
    ];
    const result = computeWindowedAverage(rows, new Date("2026-09-01"), new Date("2026-09-02"));
    expect(result).toBe(15);
  });

  it("returns null when coverage is below the minimum threshold", () => {
    // A 10-day window with only 2 real data points (20% coverage, below 50%)
    const rows = [
      { date: "2026-09-01", value: 10 },
      { date: "2026-09-02", value: 20 },
    ];
    const result = computeWindowedAverage(rows, new Date("2026-09-01"), new Date("2026-09-10"));
    expect(result).toBeNull();
  });

  it("respects a custom minimum coverage percentage", () => {
    const rows = [{ date: "2026-09-01", value: 10 }];
    // 1/10 days = 10% coverage, passes a lowered 5% threshold
    expect(computeWindowedAverage(rows, new Date("2026-09-01"), new Date("2026-09-10"), 0.05)).toBe(10);
  });
});

describe("computeReverseDietMilestone", () => {
  const asOf = new Date("2026-09-12T00:00:00");

  function buildDailyRows(startDaysAgo: number, endDaysAgo: number, value: number): { date: string; value: number }[] {
    const rows: { date: string; value: number }[] = [];
    for (let d = startDaysAgo; d >= endDaysAgo; d--) {
      const date = new Date(asOf);
      date.setDate(date.getDate() - d);
      rows.push({ date: date.toISOString().slice(0, 10), value });
    }
    return rows;
  }

  it("qualifies when calories rise and weight holds flat over the window", () => {
    // 6-week window = 42 days. First half (days 41..21 ago): 2200 kcal,
    // 180 lb. Second half (days 20..0 ago): 2300 kcal (+100, over
    // threshold), 180 lb (flat).
    const calorieRows = [...buildDailyRows(41, 21, 2200), ...buildDailyRows(20, 0, 2300)];
    const weightRows = [...buildDailyRows(41, 21, 180), ...buildDailyRows(20, 0, 180)];
    const result = computeReverseDietMilestone(calorieRows, weightRows, asOf);
    expect(result).not.toBeNull();
    expect(result!.qualifies).toBe(true);
    expect(result!.calorieIncrease).toBe(100);
    expect(result!.weightChangePct).toBe(0);
  });

  it("does not qualify when the calorie increase is below threshold", () => {
    const calorieRows = [...buildDailyRows(41, 21, 2200), ...buildDailyRows(20, 0, 2230)]; // +30
    const weightRows = [...buildDailyRows(41, 21, 180), ...buildDailyRows(20, 0, 180)];
    const result = computeReverseDietMilestone(calorieRows, weightRows, asOf);
    expect(result).not.toBeNull();
    expect(result!.qualifies).toBe(false);
  });

  it("does not qualify when weight meaningfully increased alongside calories", () => {
    const calorieRows = [...buildDailyRows(41, 21, 2200), ...buildDailyRows(20, 0, 2300)];
    const weightRows = [...buildDailyRows(41, 21, 180), ...buildDailyRows(20, 0, 184)]; // +2.2%
    const result = computeReverseDietMilestone(calorieRows, weightRows, asOf);
    expect(result).not.toBeNull();
    expect(result!.qualifies).toBe(false);
  });

  it("qualifies when weight actually dropped, not just held flat", () => {
    const calorieRows = [...buildDailyRows(41, 21, 2200), ...buildDailyRows(20, 0, 2300)];
    const weightRows = [...buildDailyRows(41, 21, 180), ...buildDailyRows(20, 0, 177)]; // down
    const result = computeReverseDietMilestone(calorieRows, weightRows, asOf);
    expect(result!.qualifies).toBe(true);
  });

  it("returns null (not false) when there isn't enough data to judge", () => {
    const calorieRows = [{ date: "2026-09-10", value: 2300 }];
    const weightRows = [{ date: "2026-09-10", value: 180 }];
    expect(computeReverseDietMilestone(calorieRows, weightRows, asOf)).toBeNull();
  });

  it("computes the weekly-expected-gain framing from the calorie increase alone", () => {
    // +500 kcal/day => 3500 kcal/week => exactly 1 lb/week "expected" gain
    const calorieRows = [...buildDailyRows(41, 21, 2000), ...buildDailyRows(20, 0, 2500)];
    const weightRows = [...buildDailyRows(41, 21, 180), ...buildDailyRows(20, 0, 180)];
    const result = computeReverseDietMilestone(calorieRows, weightRows, asOf);
    expect(result!.weeklyExpectedGainLbs).toBe(1);
  });
});
