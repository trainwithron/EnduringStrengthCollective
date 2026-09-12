import { describe, it, expect } from "vitest";
import {
  isHabitDueOn,
  habitFrequencyLabel,
  computeHabitCompliance,
  computeCompliancePct,
} from "./habits";

describe("isHabitDueOn", () => {
  it("is due when the date's weekday is in the habit's set", () => {
    // 2026-09-07 is a Monday (weekday 1).
    expect(isHabitDueOn([1, 4], new Date("2026-09-07T00:00:00"))).toBe(true);
  });

  it("is not due when the weekday isn't included", () => {
    expect(isHabitDueOn([1, 4], new Date("2026-09-08T00:00:00"))).toBe(false); // Tuesday
  });

  it("every-day habits (all 7 weekdays) are due on any date", () => {
    expect(isHabitDueOn([0, 1, 2, 3, 4, 5, 6], new Date("2026-09-08T00:00:00"))).toBe(true);
  });

  it("is never due with an empty weekday set", () => {
    expect(isHabitDueOn([], new Date("2026-09-07T00:00:00"))).toBe(false);
  });
});

describe("habitFrequencyLabel", () => {
  it("labels all 7 weekdays as Daily", () => {
    expect(habitFrequencyLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Daily");
  });

  it("labels an empty set as Never", () => {
    expect(habitFrequencyLabel([])).toBe("Never");
  });

  it("labels Mon-Fri as Weekdays", () => {
    expect(habitFrequencyLabel([1, 2, 3, 4, 5])).toBe("Weekdays");
  });

  it("labels Sat/Sun as Weekends", () => {
    expect(habitFrequencyLabel([0, 6])).toBe("Weekends");
  });

  it("falls back to a sorted abbreviation list for anything else", () => {
    expect(habitFrequencyLabel([5, 1, 3])).toBe("Mo/We/Fr");
  });

  it("ignores duplicate weekday entries", () => {
    expect(habitFrequencyLabel([1, 1, 3])).toBe("Mo/We");
  });
});

describe("computeHabitCompliance", () => {
  // 2026-09-07..13 is Mon..Sun.
  const monday = new Date("2026-09-07T00:00:00");
  const tuesday = new Date("2026-09-08T00:00:00");
  const wednesday = new Date("2026-09-09T00:00:00");
  const window = [monday, tuesday, wednesday];

  it("sums due/completed across multiple habits", () => {
    const habits = [
      { id: "h1", weekdays: [1, 3] }, // due Mon, Wed
      { id: "h2", weekdays: [2] }, // due Tue
    ];
    const logs = [
      { habitId: "h1", logDate: "2026-09-07", completed: true },
      { habitId: "h2", logDate: "2026-09-08", completed: false },
    ];
    const result = computeHabitCompliance(habits, logs, window);
    expect(result).toEqual({ totalDue: 3, totalCompleted: 1 });
  });

  it("returns zero due for no active habits", () => {
    expect(computeHabitCompliance([], [], window)).toEqual({ totalDue: 0, totalCompleted: 0 });
  });

  it("ignores a log row for a date the habit wasn't due", () => {
    const habits = [{ id: "h1", weekdays: [1] }]; // due Mon only
    const logs = [{ habitId: "h1", logDate: "2026-09-08", completed: true }]; // logged Tue
    expect(computeHabitCompliance(habits, logs, window)).toEqual({ totalDue: 1, totalCompleted: 0 });
  });
});

describe("computeCompliancePct", () => {
  it("computes a rounded percentage", () => {
    expect(computeCompliancePct(2, 3)).toBe(67);
  });

  it("returns null (not 0) when nothing was ever due", () => {
    expect(computeCompliancePct(0, 0)).toBeNull();
  });

  it("returns 100 for a perfect week", () => {
    expect(computeCompliancePct(7, 7)).toBe(100);
  });
});
