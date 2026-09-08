import { describe, it, expect } from "vitest";
import { isHabitDueOn, habitFrequencyLabel } from "./habits";

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
