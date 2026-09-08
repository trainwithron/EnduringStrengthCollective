import { describe, it, expect } from "vitest";
import { computeWeeklyWeightTrend } from "./weight-trend";

describe("computeWeeklyWeightTrend", () => {
  it("averages the 7 days ending on the anchor as 'current' and the 7 before that as 'previous'", () => {
    // Anchor: 2026-09-14 (Monday). Current week: Sep 8-14. Previous: Sep 1-7.
    const logs = [
      { loggedDate: "2026-09-14", weight: 181 },
      { loggedDate: "2026-09-12", weight: 180 },
      { loggedDate: "2026-09-08", weight: 179 },
      { loggedDate: "2026-09-07", weight: 183 },
      { loggedDate: "2026-09-03", weight: 182 },
      { loggedDate: "2026-09-01", weight: 181 },
    ];
    const trend = computeWeeklyWeightTrend(logs, "2026-09-14");
    expect(trend.currentCount).toBe(3);
    expect(trend.currentAvg).toBe(180); // (181+180+179)/3
    expect(trend.previousCount).toBe(3);
    expect(trend.previousAvg).toBe(182); // (183+182+181)/3
    expect(trend.deltaLbs).toBe(-2);
  });

  it("returns null averages when there's no data on one or both sides", () => {
    const trend = computeWeeklyWeightTrend([], "2026-09-14");
    expect(trend.currentAvg).toBeNull();
    expect(trend.previousAvg).toBeNull();
    expect(trend.deltaLbs).toBeNull();
  });

  it("computes a delta of 0 for a genuinely maintained weight", () => {
    const logs = [
      { loggedDate: "2026-09-14", weight: 180 },
      { loggedDate: "2026-09-07", weight: 180 },
    ];
    const trend = computeWeeklyWeightTrend(logs, "2026-09-14");
    expect(trend.deltaLbs).toBe(0);
  });

  it("ignores logs older than the two-week window and logs dated after the anchor", () => {
    const logs = [
      { loggedDate: "2026-09-14", weight: 180 },
      { loggedDate: "2026-08-01", weight: 200 }, // way outside the window
      { loggedDate: "2026-09-20", weight: 999 }, // after the anchor
    ];
    const trend = computeWeeklyWeightTrend(logs, "2026-09-14");
    expect(trend.currentCount).toBe(1);
    expect(trend.currentAvg).toBe(180);
    expect(trend.previousCount).toBe(0);
  });

  it("has no gap or overlap at the current/previous week boundary", () => {
    // The current window is the 7 days ending on the anchor (diff 0-6);
    // 6 days back is the last day still in "current", 7 days back is the
    // first day in "previous".
    const logs = [
      { loggedDate: "2026-09-08", weight: 100 }, // 6 days before anchor -> current
      { loggedDate: "2026-09-07", weight: 200 }, // 7 days before anchor -> previous
    ];
    const trend = computeWeeklyWeightTrend(logs, "2026-09-14");
    expect(trend.currentAvg).toBe(100);
    expect(trend.previousAvg).toBe(200);
  });
});
