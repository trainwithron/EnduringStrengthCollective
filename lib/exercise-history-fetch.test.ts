import { describe, expect, it } from "vitest";
import { historyFromRows } from "./exercise-history-fetch";

const row = (sessionId: string, completedAt: string, weight: number | null, reps: number | null) => ({
  weight,
  reps,
  completed_at: completedAt,
  session_exercises: { session_id: sessionId },
});

describe("historyFromRows (an exercise swapped in or added mid-workout)", () => {
  it("Last time is the newest set with both a weight and reps", () => {
    const h = historyFromRows([row("s3", "2026-10-28T10:00:00Z", null, 10), row("s3", "2026-10-28T09:58:00Z", 50, 10), row("s2", "2026-10-21T10:00:00Z", 45, 10)]);
    expect(h.lastTime).toEqual({ weight: 50, reps: 10 });
  });

  it("one sparkline point per earlier session", () => {
    const h = historyFromRows([row("s2", "2026-10-21T10:00:00Z", 50, 10), row("s2", "2026-10-21T10:02:00Z", 50, 8), row("s1", "2026-10-14T10:00:00Z", 45, 10)]);
    expect(h.volumeHistory.map((p) => p.totalVolume).sort()).toEqual([450, 900]);
  });

  it("no history: nothing to show", () => {
    expect(historyFromRows([])).toEqual({ lastTime: null, volumeHistory: [] });
  });
});
