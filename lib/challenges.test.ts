import { describe, it, expect } from "vitest";
import { computeChallengeWindow, computeConsistencyPct, estimatedRevenueCents, formatCents } from "./challenges";

describe("computeChallengeWindow", () => {
  it("is day 0 on the start date itself", () => {
    const w = computeChallengeWindow("2026-09-07", 4, "2026-09-07");
    expect(w.daysElapsed).toBe(0);
    expect(w.totalDays).toBe(28);
    expect(w.hasStarted).toBe(true);
    expect(w.hasEnded).toBe(false);
  });

  it("hasn't started yet for a future start date", () => {
    const w = computeChallengeWindow("2026-10-01", 4, "2026-09-07");
    expect(w.hasStarted).toBe(false);
    expect(w.daysElapsed).toBe(0);
  });

  it("clamps daysElapsed at totalDays once the challenge is over", () => {
    const w = computeChallengeWindow("2026-01-01", 4, "2026-12-31");
    expect(w.daysElapsed).toBe(28);
    expect(w.hasEnded).toBe(true);
  });

  it("reports the correct mid-challenge day", () => {
    const w = computeChallengeWindow("2026-09-01", 6, "2026-09-15");
    expect(w.daysElapsed).toBe(14);
    expect(w.hasEnded).toBe(false);
  });
});

describe("computeConsistencyPct", () => {
  it("counts day 1 as one possible day, not zero", () => {
    // 2 habits, day 0 (day 1 of the challenge) -> 2 possible check-offs.
    expect(computeConsistencyPct(2, 2, 0)).toBe(100);
    expect(computeConsistencyPct(1, 2, 0)).toBe(50);
  });

  it("scales possible check-offs by days elapsed", () => {
    // 2 habits over 5 elapsed days (6 possible days) = 12 possible.
    expect(computeConsistencyPct(6, 2, 5)).toBe(50);
  });

  it("returns 0 rather than dividing by zero with no habits", () => {
    expect(computeConsistencyPct(0, 0, 3)).toBe(0);
  });
});

describe("estimatedRevenueCents / formatCents", () => {
  it("multiplies participants by entry fee", () => {
    expect(estimatedRevenueCents(12, 4900)).toBe(58800);
  });

  it("formats cents as a dollar string", () => {
    expect(formatCents(58800)).toBe("$588");
    expect(formatCents(4900)).toBe("$49");
  });
});
