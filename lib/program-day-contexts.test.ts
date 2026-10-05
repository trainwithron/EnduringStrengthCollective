import { describe, it, expect } from "vitest";
import {
  resolveSessionsForDate,
  summarizeSessions,
  emptyDayInfo,
  type ProgramDayContext,
} from "./program-day-contexts";

function ctx(over: { id: string; date?: Date; wid?: string; title?: string; unscheduled?: boolean }): ProgramDayContext {
  const date = over.date ?? new Date(2026, 9, 6); // Tue Oct 6
  return {
    program: {
      id: over.id,
      name: over.id,
      label: null,
      sortOrder: null,
      createdAt: "2026-09-01T00:00:00Z",
      athleteId: null,
      startDate: "2026-09-01",
      trainingDays: [2],
      visibilityWindow: "day",
    },
    heading: over.id,
    unscheduled: over.unscheduled ?? false,
    scheduled: over.unscheduled ? [] : [{ workoutId: over.wid ?? `${over.id}-w`, title: over.title ?? "Day", date }],
    all: over.unscheduled ? [{ id: `${over.id}-w`, title: over.title ?? "Day" }] : [],
  };
}

describe("resolveSessionsForDate with several active programs", () => {
  const today = new Date(2026, 9, 6);

  it("lists every program with a workout on the same day", () => {
    const s = resolveSessionsForDate(
      [ctx({ id: "main", title: "Squat" }), ctx({ id: "mob", title: "Hips" })],
      new Set(),
      today,
      today,
      true
    );
    expect(s.map((x) => x.programId)).toEqual(["main", "mob"]);
    expect(s.every((x) => x.status === "planned")).toBe(true);
  });

  it("a program resting that day contributes nothing, so the other shows alone", () => {
    const mobOnOtherDay = ctx({ id: "mob", date: new Date(2026, 9, 7) });
    const s = resolveSessionsForDate([ctx({ id: "main" }), mobOnOtherDay], new Set(), today, today, true);
    expect(s.map((x) => x.programId)).toEqual(["main"]);
  });

  it("a mobility program shows on a day with no main workout", () => {
    const main = ctx({ id: "main", date: new Date(2026, 9, 5) });
    const mob = ctx({ id: "mob" });
    const s = resolveSessionsForDate([main, mob], new Set(), today, today, true);
    expect(s.map((x) => x.programId)).toEqual(["mob"]);
  });

  it("keeps a done session next to one still to do", () => {
    const s = resolveSessionsForDate(
      [ctx({ id: "main", wid: "w1" }), ctx({ id: "mob", wid: "w2" })],
      new Set(["w1"]),
      today,
      today,
      true
    );
    expect(s.map((x) => [x.programId, x.status])).toEqual([
      ["main", "done"],
      ["mob", "planned"],
    ]);
  });

  it("a playlist-style program only shows on today", () => {
    const pl = ctx({ id: "flow", unscheduled: true });
    expect(resolveSessionsForDate([pl], new Set(), today, today, true).map((x) => x.programId)).toEqual(["flow"]);
    expect(resolveSessionsForDate([pl], new Set(), new Date(2026, 9, 9), today, false)).toEqual([]);
  });
});

describe("summarizeSessions and emptyDayInfo", () => {
  it("a cell shows the most actionable session", () => {
    const s = [
      { status: "done" as const, workoutId: "a", title: "A", programId: "1", heading: "1" },
      { status: "planned" as const, workoutId: "b", title: "B", programId: "2", heading: "2" },
    ];
    expect(summarizeSessions(s, { status: "rest", workoutId: null, title: null }).workoutId).toBe("b");
  });

  it("empty states match what single-program Home always showed", () => {
    expect(emptyDayInfo([], true).status).toBe("no-program");
    expect(emptyDayInfo([ctx({ id: "x" })], true).status).toBe("rest");
    expect(emptyDayInfo([ctx({ id: "x", unscheduled: true })], false).status).toBe("unscheduled");
  });
});

import { findNextWorkoutDate, nextWorkoutLabel } from "./program-day-contexts";

describe("next workout after today is done", () => {
  const today = new Date(2026, 9, 6); // Tue Oct 6

  it("finds the next scheduled day and words it as a weekday or Tomorrow", () => {
    const thursday = new Date(2026, 9, 8);
    const next = findNextWorkoutDate([ctx({ id: "main", date: thursday })], new Set(), today);
    expect(next?.getDate()).toBe(8);
    expect(nextWorkoutLabel(next, today)).toBe("Thursday");
    expect(nextWorkoutLabel(new Date(2026, 9, 7), today)).toBe("Tomorrow");
  });

  it("is null when nothing is coming up or the program has no dates", () => {
    expect(findNextWorkoutDate([ctx({ id: "p", unscheduled: true })], new Set(), today)).toBeNull();
    expect(nextWorkoutLabel(null, today)).toBeNull();
  });

  it("skips a day whose workout is already logged", () => {
    const thursday = new Date(2026, 9, 8);
    const c = ctx({ id: "main", date: thursday, wid: "w-thu" });
    expect(findNextWorkoutDate([c], new Set(["w-thu"]), today)).toBeNull();
  });
});
