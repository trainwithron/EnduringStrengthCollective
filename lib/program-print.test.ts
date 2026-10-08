import { describe, it, expect } from "vitest";
import { describePrescription, groupPrintWeeks, releasedDayIds, type PrintDay } from "./program-print";
import type { ExerciseSetTarget } from "./types";

const set = (order: number, over: Partial<ExerciseSetTarget> = {}): ExerciseSetTarget => ({
  id: `s${order}`,
  setOrder: order,
  targetReps: null,
  targetWeight: null,
  targetRpe: null,
  targetRir: null,
  targetTempo: null,
  targetTimeSeconds: null,
  targetHeight: null,
  targetDistance: null,
  targetRestSeconds: null,
  targetPace: null,
  repMin: null,
  repMax: null,
  ...over,
});

describe("what is prescribed, on one line", () => {
  it("sets x reps with load and effort", () => {
    expect(describePrescription([1, 2, 3].map((i) => set(i, { targetReps: "10", targetWeight: 135, targetRpe: 7 })))).toBe("3 x 10 @ 135 lb, RPE 7");
  });
  it("sets that differ are written out, not hidden", () => {
    expect(describePrescription([set(1, { targetReps: "10", targetWeight: 135 }), set(2, { targetReps: "8", targetWeight: 145 }), set(3, { targetReps: "6", targetWeight: 155 })])).toBe("3 sets: 10/8/6 @ 135/145/155 lb");
  });
  it("seconds, distance, rest, tempo and pace when that is what was set", () => {
    expect(describePrescription([set(1, { targetTimeSeconds: 45, targetRestSeconds: 60 }), set(2, { targetTimeSeconds: 45, targetRestSeconds: 60 })])).toBe("2 x 45s, rest 60s");
    expect(describePrescription([set(1, { targetDistance: 400, targetPace: "8:30" })])).toBe("1 x 400, pace 8:30");
    expect(describePrescription([set(1, { targetReps: "5", targetTempo: "3-1-1" })])).toBe("1 x 5, tempo 3-1-1");
  });
  it("nothing prescribed is just the number of sets, and no sets is empty", () => {
    expect(describePrescription([set(1), set(2), set(3)])).toBe("3 sets");
    expect(describePrescription([set(1)])).toBe("1 set");
    expect(describePrescription([])).toBe("");
  });
  it("orders sets by their own order, not the order they arrive", () => {
    expect(describePrescription([set(2, { targetReps: "8" }), set(1, { targetReps: "10" })])).toBe("2 sets: 10/8");
  });
});

describe("which days a client or member may print", () => {
  const day = (id: string, week: number, index: number, exercises: number): PrintDay => ({
    id,
    title: id,
    weekNumber: week,
    dayIndex: index,
    exercises: Array.from({ length: exercises }, (_, i) => ({ name: "Ex " + i, prescription: "3 x 10" })),
  });
  const days = [day("d1", 1, 1, 4), day("d2", 1, 2, 3), day("d3", 2, 1, 0), day("d4", 2, 2, 5)];
  it("only released days: a locked day is dropped, and so is a day that came back empty", () => {
    const keep = releasedDayIds(days, (id) => id === "d4");
    expect(Array.from(keep).sort()).toEqual(["d1", "d2"]);
    expect(groupPrintWeeks(days, keep).map((w) => w.weekNumber)).toEqual([1]);
  });
  it("the coach passes no filter and gets every day, empty ones included", () => {
    expect(groupPrintWeeks(days).flatMap((w) => w.days.map((d) => d.id))).toEqual(["d1", "d2", "d3", "d4"]);
  });
});

describe("weeks and days", () => {
  const day = (id: string, week: number, index: number): PrintDay => ({ id, title: id, weekNumber: week, dayIndex: index, exercises: [] });
  const days = [day("c", 2, 1), day("a", 1, 1), day("b", 1, 2), day("d", 2, 2)];
  it("groups by week in order, days in order", () => {
    expect(groupPrintWeeks(days).map((w) => [w.weekNumber, w.days.map((d) => d.id)])).toEqual([
      [1, ["a", "b"]],
      [2, ["c", "d"]],
    ]);
  });
  it("keeps only released days when given, dropping a week with none", () => {
    expect(groupPrintWeeks(days, new Set(["a", "b"])).map((w) => w.weekNumber)).toEqual([1]);
    expect(groupPrintWeeks(days, new Set(["a", "d"])).map((w) => [w.weekNumber, w.days.map((d) => d.id)])).toEqual([
      [1, ["a"]],
      [2, ["d"]],
    ]);
  });
});
