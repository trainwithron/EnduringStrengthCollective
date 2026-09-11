import { describe, it, expect } from "vitest";
import { computeScheduledDates, isSameDay, isLocked, defaultTrainingDaysForCount } from "./program-schedule";

describe("computeScheduledDates", () => {
  it("walks forward through training days in order, skipping non-training days", () => {
    const workouts = [{ id: "a" }, { id: "b" }, { id: "c" }];
    // Sunday 2026-09-06, training on Mon(1) and Thu(4).
    const result = computeScheduledDates("2026-09-06", [1, 4], workouts);
    expect(result.get("a")?.toISOString().slice(0, 10)).toBe("2026-09-07"); // Mon
    expect(result.get("b")?.toISOString().slice(0, 10)).toBe("2026-09-10"); // Thu
    expect(result.get("c")?.toISOString().slice(0, 10)).toBe("2026-09-14"); // next Mon
  });

  it("returns an empty map when there are no workouts or no training days", () => {
    expect(computeScheduledDates("2026-09-06", [1], []).size).toBe(0);
    expect(computeScheduledDates("2026-09-06", [], [{ id: "a" }]).size).toBe(0);
  });
});

describe("defaultTrainingDaysForCount", () => {
  it("spreads rest days between training days rather than clustering at the week's start", () => {
    expect(defaultTrainingDaysForCount(3)).toEqual([1, 3, 5]); // Mon/Wed/Fri, not Mon/Tue/Wed
    expect(defaultTrainingDaysForCount(4)).toEqual([1, 2, 4, 5]);
  });

  it("trains every day at 7/week since there's no day left to rest on", () => {
    expect(defaultTrainingDaysForCount(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("returns null for a count with no sensible default (0, or anything past a week)", () => {
    expect(defaultTrainingDaysForCount(0)).toBeNull();
    expect(defaultTrainingDaysForCount(8)).toBeNull();
  });
});

describe("isSameDay", () => {
  it("compares calendar date only, ignoring time", () => {
    expect(isSameDay(new Date("2026-09-06T01:00:00"), new Date("2026-09-06T23:00:00"))).toBe(
      true
    );
    expect(isSameDay(new Date("2026-09-06"), new Date("2026-09-07"))).toBe(false);
  });
});

describe("isLocked", () => {
  const today = new Date("2026-09-06T00:00:00");

  it("has no opinion when there's no scheduled date", () => {
    expect(isLocked(undefined, today)).toBe(false);
  });

  it("defaults to 'day': only today-or-earlier is unlocked", () => {
    expect(isLocked(new Date("2026-09-06T00:00:00"), today)).toBe(false);
    expect(isLocked(new Date("2026-09-05T00:00:00"), today)).toBe(false);
    expect(isLocked(new Date("2026-09-07T00:00:00"), today)).toBe(true);
  });

  it("'week' unlocks up to 7 days out, not 8", () => {
    expect(isLocked(new Date("2026-09-13T00:00:00"), today, "week")).toBe(false);
    expect(isLocked(new Date("2026-09-14T00:00:00"), today, "week")).toBe(true);
  });

  it("'month' unlocks up to 30 days out, not 31", () => {
    expect(isLocked(new Date("2026-10-06T00:00:00"), today, "month")).toBe(false);
    expect(isLocked(new Date("2026-10-07T00:00:00"), today, "month")).toBe(true);
  });

  it("'full' never locks anything, no matter how far out", () => {
    expect(isLocked(new Date("2030-01-01T00:00:00"), today, "full")).toBe(false);
  });
});
