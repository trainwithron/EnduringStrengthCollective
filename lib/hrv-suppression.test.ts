import { describe, expect, it } from "vitest";
import { isSustainedHrvSuppression } from "./hrv-suppression";

function points(values: number[]): { date: string; value: number }[] {
  return values.map((value, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value }));
}

describe("isSustainedHrvSuppression", () => {
  it("is false when the connection is newer than the minimum age, even with 7 low days", () => {
    expect(isSustainedHrvSuppression(points([40, 40, 40, 40, 40, 40, 40]), 30)).toBe(false);
  });

  it("is false with fewer than 7 days of readings, even if all are low", () => {
    expect(isSustainedHrvSuppression(points([40, 40, 40, 40, 40]), 90)).toBe(false);
  });

  it("is false for one bad night surrounded by normal readings", () => {
    expect(isSustainedHrvSuppression(points([60, 65, 30, 70, 62, 58, 66]), 90)).toBe(false);
  });

  it("is true for a genuine 7-day sustained suppression with an established connection", () => {
    expect(isSustainedHrvSuppression(points([45, 42, 38, 40, 35, 30, 44]), 90)).toBe(true);
  });

  it("is false if even one of the last 7 days is at or above the threshold", () => {
    expect(isSustainedHrvSuppression(points([45, 42, 38, 40, 35, 51, 44]), 90)).toBe(false);
  });

  it("only looks at the trailing window when given more than 7 days of points", () => {
    // The suppression only holds for the most recent 7 — an older low
    // stretch further back doesn't count.
    const older = points([30, 30, 30, 30, 30, 30, 30]);
    const recentGood = points([60, 62, 58, 65, 70, 61, 59]).map((p, i) => ({ ...p, date: `2026-02-${i + 1}` }));
    expect(isSustainedHrvSuppression([...older, ...recentGood], 90)).toBe(false);
  });
});
