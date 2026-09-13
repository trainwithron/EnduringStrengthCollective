import { describe, expect, it } from "vitest";
import { computeVolumeHistory } from "./exercise-volume-history";

describe("computeVolumeHistory", () => {
  it("sums weight x reps per session, one point per session (not per set)", () => {
    const result = computeVolumeHistory([
      { sessionId: "s1", completedAt: "2026-01-01T10:00:00Z", weight: 100, reps: 5 },
      { sessionId: "s1", completedAt: "2026-01-01T10:05:00Z", weight: 100, reps: 5 },
      { sessionId: "s2", completedAt: "2026-01-08T10:00:00Z", weight: 110, reps: 5 },
    ]);
    expect(result).toEqual([
      { sessionId: "s1", sessionDate: "2026-01-01T10:00:00Z", totalVolume: 1000 },
      { sessionId: "s2", sessionDate: "2026-01-08T10:00:00Z", totalVolume: 550 },
    ]);
  });

  it("sorts sessions by earliest completed-set timestamp, ascending", () => {
    const result = computeVolumeHistory([
      { sessionId: "later", completedAt: "2026-02-01T00:00:00Z", weight: 50, reps: 10 },
      { sessionId: "earlier", completedAt: "2026-01-01T00:00:00Z", weight: 50, reps: 10 },
    ]);
    expect(result.map((r) => r.sessionId)).toEqual(["earlier", "later"]);
  });

  it("uses a session's earliest set timestamp, not its latest", () => {
    const result = computeVolumeHistory([
      { sessionId: "s1", completedAt: "2026-01-05T12:00:00Z", weight: 100, reps: 5 },
      { sessionId: "s1", completedAt: "2026-01-05T09:00:00Z", weight: 100, reps: 5 },
    ]);
    expect(result[0].sessionDate).toBe("2026-01-05T09:00:00Z");
  });

  it("skips a set missing weight or reps rather than treating it as zero", () => {
    const result = computeVolumeHistory([
      { sessionId: "s1", completedAt: "2026-01-01T00:00:00Z", weight: null, reps: 8 },
      { sessionId: "s1", completedAt: "2026-01-01T00:01:00Z", weight: 100, reps: null },
      { sessionId: "s1", completedAt: "2026-01-01T00:02:00Z", weight: 100, reps: 5 },
    ]);
    expect(result).toEqual([
      { sessionId: "s1", sessionDate: "2026-01-01T00:02:00Z", totalVolume: 500 },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(computeVolumeHistory([])).toEqual([]);
  });
});
