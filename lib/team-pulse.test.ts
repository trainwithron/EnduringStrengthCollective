import { describe, expect, it } from "vitest";
import { computeTeamPulse } from "./team-pulse";

describe("computeTeamPulse", () => {
  it("averages all three components when all are present", () => {
    // readiness 5 -> 100, active 80, habits 60 -> avg 80
    expect(computeTeamPulse({ avgReadinessToday: 5, pctActiveThisWeek: 80, habitCompliancePct: 60 })).toBe(80);
  });

  it("rescales a mid readiness value onto the 0-100 basis correctly", () => {
    // readiness 3 -> ((3-1)/4)*100 = 50
    expect(computeTeamPulse({ avgReadinessToday: 3, pctActiveThisWeek: 50, habitCompliancePct: 50 })).toBe(50);
  });

  it("drops a missing component from the average instead of scoring it 0", () => {
    // No habit data at all -> average of just readiness(100) and active(50) = 75
    expect(computeTeamPulse({ avgReadinessToday: 5, pctActiveThisWeek: 50, habitCompliancePct: null })).toBe(75);
  });

  it("returns null when every component is missing", () => {
    expect(computeTeamPulse({ avgReadinessToday: null, pctActiveThisWeek: null, habitCompliancePct: null })).toBeNull();
  });

  it("computes from a single present component", () => {
    expect(computeTeamPulse({ avgReadinessToday: null, pctActiveThisWeek: null, habitCompliancePct: 42 })).toBe(42);
  });

  it("handles the lowest readiness value correctly (1 -> 0)", () => {
    expect(computeTeamPulse({ avgReadinessToday: 1, pctActiveThisWeek: null, habitCompliancePct: null })).toBe(0);
  });
});
