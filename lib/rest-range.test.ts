import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatRestSpan, restForSet, parseRestSpan } from "@/lib/rest-time";
import { summarizeSets } from "@/lib/exercise-summary";
import { mapSetRow } from "@/lib/exercise-fields";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron: "I want it 60-90. It should be a range." The low end stays in target_rest_seconds; target_rest_max_seconds holds the high end; a single time stays a single time.
describe("a rest range is shown as a range", () => {
  it("60-90 s when both ends are under two minutes, m:ss otherwise, a single time as m:ss", () => {
    expect(formatRestSpan(60, 90)).toBe("60-90 s");
    expect(formatRestSpan(90, 150)).toBe("1:30-2:30");
    expect(formatRestSpan(90)).toBe("1:30");
    expect(formatRestSpan(90, null)).toBe("1:30");
  });
  it("what is typed in a cell comes back out the same way", () => {
    expect(parseRestSpan("60-90")).toEqual({ low: 60, high: 90 });
    expect(parseRestSpan("1:30-2:30")).toEqual({ low: 90, high: 150 });
  });
  it("a row from the database keeps both ends, and a set with no high end has none", () => {
    const base = { id: "a", set_order: 0, target_reps: null, target_weight: null, target_rpe: null, target_rir: null, target_tempo: null, target_time_seconds: null, target_height: null, target_distance: null };
    expect(mapSetRow({ ...base, target_rest_seconds: 60, target_rest_max_seconds: 90 })).toMatchObject({ targetRestSeconds: 60, targetRestMaxSeconds: 90 });
    expect(mapSetRow({ ...base, target_rest_seconds: 90 })).toMatchObject({ targetRestSeconds: 90, targetRestMaxSeconds: null });
  });
  it("the builder card summary shows the range across sets", () => {
    const sets = [0, 1].map(() => ({ targetReps: "5", targetWeight: null, targetTimeSeconds: null, targetDistance: null, targetHeight: null, targetRestSeconds: 60, targetRestMaxSeconds: 90 }));
    expect(summarizeSets(sets, ["reps", "rest"], { withRest: true } as never)).toContain("rest 60-90s");
  });
});

describe("the logger gives the timer the range", () => {
  it("restForSet returns the low end as the rest and the high end beside it, and a set that inherits a range inherits both", () => {
    const sets = [
      { id: "s0", setOrder: 0, targetRestSeconds: 60, targetRestMaxSeconds: 90, restSeconds: null },
      { id: "s1", setOrder: 1, targetRestSeconds: null, restSeconds: null },
      { id: "s2", setOrder: 2, targetRestSeconds: 45, targetRestMaxSeconds: null, restSeconds: null },
    ];
    expect(restForSet(sets, "s0")).toEqual({ seconds: 60, maxSeconds: 90, source: "coach" });
    expect(restForSet(sets, "s1")).toEqual({ seconds: 60, maxSeconds: 90, source: "coach" });
    expect(restForSet(sets, "s2")).toEqual({ seconds: 45, source: "coach" });
  });
  it("the timer counts to the high end, alerts once at the low end, and says the client can go", () => {
    const bar = read("components/session/rest-timer-bar.tsx");
    expect(bar).toContain("readyAlerted");
    expect(bar).toContain("running.durationSeconds - remainingNow >= running.readySeconds");
    expect(bar).toContain("You can go now. Your coach's rest is");
    expect(read("components/logging/session-logger.tsx")).toContain("defaultSeconds: rest.maxSeconds ?? rest.seconds");
  });
});

describe("a range is saved and copied everywhere a rest is", () => {
  it("cells, Bulk edit, the AI day builder, Duplicate weeks, add-set and Duplicate program all carry the high end", () => {
    expect(read("components/coach/exercise-builder-card.tsx")).toContain("target_rest_max_seconds: high");
    expect(read("components/coach/exercise-builder-card.tsx")).toContain("target_rest_max_seconds: last?.targetRestMaxSeconds ?? null");
    expect(read("components/coach/desktop/bulk-edit-day-panel.tsx")).toContain("target_rest_max_seconds: high");
    expect(read("app/api/ai/build-day/route.ts")).toContain("target_rest_max_seconds: restSpan?.high ?? null");
    expect(read("components/coach/desktop/duplicate-week-panel.tsx")).toContain("target_rest_max_seconds: track.otherTargets.restMaxSeconds ?? null");
    expect(read("supabase/migrations/0367_rest_range.sql")).toContain("target_rest_seconds, target_rest_max_seconds, target_pace");
  });
  it("a changed single rest clears any old high end (a range never survives a change to one time)", () => {
    expect(read("components/coach/exercise-builder-card.tsx")).toContain("target_rest_max_seconds: high");
    expect(read("components/coach/exercise-builder-card.tsx")).toContain("target_rest_seconds: suggestion.restSeconds, target_rest_max_seconds: null");
  });
});
