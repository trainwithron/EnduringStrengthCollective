import { describe, it, expect } from "vitest";
import { computeSleepEfficiencyFromStages } from "./google-health";

describe("computeSleepEfficiencyFromStages", () => {
  it("computes 100% efficiency when every stage is real sleep, no AWAKE time", () => {
    const result = computeSleepEfficiencyFromStages([
      { startTime: "2025-01-01T22:00:00Z", endTime: "2025-01-01T23:00:00Z", type: "LIGHT" },
      { startTime: "2025-01-01T23:00:00Z", endTime: "2025-01-02T00:00:00Z", type: "DEEP" },
    ]);
    expect(result).toBe(100);
  });

  it("excludes AWAKE stages from the asleep portion of the ratio", () => {
    // 3 hours total, 1 of which is AWAKE -> 2/3 asleep = 67% (rounded)
    const result = computeSleepEfficiencyFromStages([
      { startTime: "2025-01-01T22:00:00Z", endTime: "2025-01-02T00:00:00Z", type: "LIGHT" },
      { startTime: "2025-01-02T00:00:00Z", endTime: "2025-01-02T01:00:00Z", type: "AWAKE" },
    ]);
    expect(result).toBe(67);
  });

  it("returns null for an empty stage list — nothing to compute from", () => {
    expect(computeSleepEfficiencyFromStages([])).toBeNull();
  });

  it("returns null when stages is undefined", () => {
    expect(computeSleepEfficiencyFromStages(undefined)).toBeNull();
  });

  it("skips a malformed stage (non-string timestamps) without throwing", () => {
    const result = computeSleepEfficiencyFromStages([
      { startTime: 123, endTime: 456, type: "LIGHT" },
      { startTime: "2025-01-01T22:00:00Z", endTime: "2025-01-01T23:00:00Z", type: "DEEP" },
    ]);
    expect(result).toBe(100);
  });

  it("skips a stage whose end is not after its start", () => {
    const result = computeSleepEfficiencyFromStages([
      { startTime: "2025-01-01T23:00:00Z", endTime: "2025-01-01T22:00:00Z", type: "LIGHT" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null when every stage is malformed and no real duration accumulates", () => {
    const result = computeSleepEfficiencyFromStages([{ startTime: "not-a-date", endTime: "also-not-a-date" }]);
    expect(result).toBeNull();
  });
});
