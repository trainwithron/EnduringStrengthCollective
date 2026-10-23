import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSessionPatternFindings, findingSentence, type PatternSession, type PatternSet } from "./session-pattern-evidence";
import { MAX_PLAUSIBLE_SESSION_SECONDS, lastSetTime, plausibleSessionSeconds } from "./session-duration";

// Ron, Oct 23, on Jaxson Kremer's pattern note: "I don't know why that's showing me that" (a Monday where every set of 185 x 8 was done), box jumps they were not doing, and
// "now I have like a 17-hour workout. It should be able to know that that's not right."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const done = (o: number, w: number | null = 185, r = 8): PatternSet => ({ set_order: o, weight: w, reps: r, status: "completed" });
const untouched = (o: number, r = 5): PatternSet => ({ set_order: o, weight: null, reps: r, status: "pending" });
const sess = (iso: string, first: { name: string; sets: PatternSet[] }, minutes = 55): PatternSession => ({
  id: iso,
  started_at: iso,
  completed_at: new Date(Date.parse(iso) + minutes * 60000).toISOString(),
  duration_seconds: minutes * 60,
  session_exercises: [
    { exercise_order: 0, exercise_name: first.name, tracked_fields: ["reps", "weight"], group_workout_exercise_id: null, set_logs: first.sets },
    { exercise_order: 1, exercise_name: "Trap Bar Deadlift", tracked_fields: ["reps", "weight"], group_workout_exercise_id: null, set_logs: [done(0), done(1), done(2)] },
  ],
});

describe("an exercise left out on purpose is not a struggle", () => {
  // Jaxson: box jumps and broad jumps on the program, left untouched (prefilled reps, nothing logged); the other sessions' first exercise all done.
  const sessions = [
    sess("2026-09-14T12:00:00Z", { name: "Trap Bar Deadlift", sets: [done(0), done(1), done(2)] }),
    sess("2026-09-21T12:00:00Z", { name: "Step Ups", sets: [done(0, null), done(1, null), done(2, null)] }),
    sess("2026-10-13T21:00:00Z", { name: "Diagonal Bounding Jumps", sets: [untouched(0), untouched(1), untouched(2)] }),
    sess("2026-10-15T21:00:00Z", { name: "Diagonal Bounding Jumps", sets: [done(0, 0, 5), done(1, 0, 5), done(2, 0, 5)] }),
    sess("2026-10-19T21:00:00Z", { name: "Broad Jumps For Distance", sets: [untouched(0, 3), untouched(1, 3), untouched(2, 3)] }),
    sess("2026-10-22T22:00:00Z", { name: "Box Jump", sets: [untouched(0), untouched(1), untouched(2)] }),
  ];
  it("no finding: every set of the first exercise that was done counts, and the ones never touched are left out", () => {
    expect(buildSessionPatternFindings(sessions, new Map(), "America/Chicago").find((f) => f.kind === "struggle_point")).toBeUndefined();
  });
  it("a real struggle still shows, with ONLY the sessions that fell short as rows, and says done plainly", () => {
    const partial = (iso: string) => sess(iso, { name: "Box Jump", sets: [done(0, 0, 5), untouched(1), untouched(2)] });
    const mixed = [...sessions, partial("2026-10-23T22:00:00Z"), partial("2026-10-24T22:00:00Z"), partial("2026-10-25T22:00:00Z"), partial("2026-10-26T22:00:00Z")];
    const f = buildSessionPatternFindings(mixed, new Map(), "America/Chicago").find((x) => x.kind === "struggle_point")!;
    expect(f).toBeDefined();
    if (f.evidence?.kind !== "slot_sets") throw new Error("no rows");
    expect(f.evidence.rows.every((r) => r.done < r.total)).toBe(true);
    expect(f.evidence.rows.map((r) => r.startedAt.slice(0, 10))).toEqual(["2026-10-26", "2026-10-25", "2026-10-24", "2026-10-23"]);
    expect(f.evidence.sessions).toBe(7);
    expect(findingSentence(f, "America/Chicago")).toBe(
      "Worth a look: the first exercise was cut short in 4 of the last 7 sessions (Oct 23 Box Jump, Oct 24 Box Jump, Oct 25 Box Jump, Oct 26 Box Jump)."
    );
    expect(read("components/coach/pattern-evidence.tsx")).toContain("{r.done} of {r.total} sets done");
  });
});

describe("a workout left open is not a 17-hour workout", () => {
  it("a believable length is kept; one over 4 hours or finished the next day is timed by its last set, or left out", () => {
    expect(plausibleSessionSeconds({ startedAt: "2026-10-19T21:59:51Z", completedAt: "2026-10-19T23:00:06Z", durationSeconds: 3615, timeZone: "America/Chicago" })).toBe(3615);
    // Jaxson, Oct 22: started 5:09 PM, finished the next morning; the last set was at 6:00 PM
    const oct22 = { startedAt: "2026-10-22T22:09:48Z", completedAt: "2026-10-23T15:11:45Z", durationSeconds: 61317, timeZone: "America/Chicago" };
    expect(plausibleSessionSeconds({ ...oct22, lastSetAt: "2026-10-22T23:00:58Z" })).toBe(3070);
    expect(plausibleSessionSeconds(oct22)).toBeNull();
    // under 4 hours but finished on the next day (in the coach's time zone): not believed either
    expect(plausibleSessionSeconds({ startedAt: "2026-10-23T04:30:00Z", completedAt: "2026-10-23T06:30:00Z", durationSeconds: 7200, timeZone: "America/Chicago" })).toBeNull();
    expect(MAX_PLAUSIBLE_SESSION_SECONDS).toBe(14400);
    expect(lastSetTime([{ completed_at: null }, { completed_at: "2026-10-22T22:13:35Z" }, { completed_at: "2026-10-22T23:00:58Z" }])).toBe("2026-10-22T23:00:58Z");
  });
  it("the weekday average uses it: the 17-hour Thursday does not count at its recorded length", () => {
    const at = (iso: string, minutes: number, lastSet?: string): PatternSession => ({
      id: iso,
      started_at: iso,
      completed_at: new Date(Date.parse(iso) + minutes * 60000).toISOString(),
      duration_seconds: minutes * 60,
      session_exercises: [{ exercise_order: 0, exercise_name: "Row", tracked_fields: ["reps", "weight"], group_workout_exercise_id: null, set_logs: [{ ...done(0), completed_at: lastSet ?? null }] }],
    });
    const sessions = [
      at("2026-09-28T21:00:00Z", 60), at("2026-10-05T21:00:00Z", 60), at("2026-10-12T21:00:00Z", 60),
      at("2026-10-01T21:00:00Z", 60), at("2026-10-08T21:00:00Z", 60), at("2026-10-15T21:00:00Z", 60),
      at("2026-10-22T22:00:00Z", 1022, "2026-10-22T23:00:00Z"),
    ];
    const f = buildSessionPatternFindings(sessions, new Map(), "America/Chicago").find((x) => x.kind === "weekday_rushing");
    // every day averages about an hour once the open workout is timed by its last set: nothing stands out
    expect(f).toBeUndefined();
    expect(read("lib/session-pattern-spotter-gather.ts")).toContain("status, completed_at ) )");
    expect(read("lib/calendar-spotter-phase2-gather.ts")).toContain("plausibleSessionSeconds({");
  });
});
