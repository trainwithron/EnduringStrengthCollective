import { describe, it, expect } from "vitest";
import { computeProgramDayProgress } from "./program-day-progress";

describe("computeProgramDayProgress", () => {
  it("computes day 1 on the start date itself", () => {
    const result = computeProgramDayProgress("2026-01-01", new Date(2026, 2, 25), new Date(2026, 0, 1));
    expect(result?.dayNumber).toBe(1);
  });

  it("computes the correct total span and mid-program day", () => {
    // Jan 1 to Jan 10 inclusive = 10 total days; today = Jan 5 = day 5.
    const result = computeProgramDayProgress("2026-01-01", new Date(2026, 0, 10), new Date(2026, 0, 5));
    expect(result).toEqual({ dayNumber: 5, totalDays: 10 });
  });

  it("clamps to totalDays once the program's calendar span has passed", () => {
    const result = computeProgramDayProgress("2026-01-01", new Date(2026, 0, 10), new Date(2026, 1, 1));
    expect(result?.dayNumber).toBe(10);
  });

  it("clamps to day 1 if today is somehow before the start date", () => {
    const result = computeProgramDayProgress("2026-01-10", new Date(2026, 1, 1), new Date(2026, 0, 1));
    expect(result?.dayNumber).toBe(1);
  });

  it("returns null when the last scheduled date is before the start date", () => {
    const result = computeProgramDayProgress("2026-01-10", new Date(2026, 0, 1), new Date(2026, 0, 5));
    expect(result).toBeNull();
  });
});
