import { describe, it, expect } from "vitest";
import { computeWeekStreak } from "./consistency-streak";

// Wednesdays, so each date sits safely inside its own Sun-Sat week
// regardless of local timezone rounding.
const asOf = new Date("2026-09-16T12:00:00"); // a Wednesday

describe("computeWeekStreak", () => {
  it("counts 3 consecutive weeks with at least one log each", () => {
    const logDates = [
      new Date("2026-09-16T12:00:00"), // this week
      new Date("2026-09-09T12:00:00"), // last week
      new Date("2026-09-02T12:00:00"), // two weeks ago
    ];
    expect(computeWeekStreak(logDates, asOf)).toBe(3);
  });

  it("stops counting at the first gap week", () => {
    const logDates = [
      new Date("2026-09-16T12:00:00"), // this week
      // gap: no log the week of Sep 9
      new Date("2026-09-02T12:00:00"), // two weeks ago — shouldn't count
    ];
    expect(computeWeekStreak(logDates, asOf)).toBe(1);
  });

  it("returns 1 for a single logged week", () => {
    expect(computeWeekStreak([new Date("2026-09-16T12:00:00")], asOf)).toBe(1);
  });

  it("returns 0 when there's no log at all in the current week", () => {
    expect(computeWeekStreak([new Date("2026-08-01T12:00:00")], asOf)).toBe(0);
  });

  it("returns 0 for an empty log list", () => {
    expect(computeWeekStreak([], asOf)).toBe(0);
  });
});
