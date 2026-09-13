import { describe, it, expect } from "vitest";
import { deriveEventWindow, weeksUntilEvent, isWithinTaperWindow, type ConfirmedGoalRow } from "./event-window";

function goal(overrides: Partial<ConfirmedGoalRow>): ConfirmedGoalRow {
  return {
    status: "confirmed",
    targetDate: "2026-10-01",
    eventType: "Marathon",
    eventExpectedDurationMinutes: 240,
    eventPriority: "A",
    weightClassFlag: false,
    ...overrides,
  };
}

describe("deriveEventWindow", () => {
  it("derives a real event window from a confirmed goal with a target date", () => {
    const window = deriveEventWindow(goal({}));
    expect(window).toEqual({
      targetDate: "2026-10-01",
      sportType: "Marathon",
      expectedDurationMinutes: 240,
      priority: "A",
      weightClassFlag: false,
    });
  });

  it("returns null for a still-proposed goal — never drives real numbers", () => {
    expect(deriveEventWindow(goal({ status: "proposed" }))).toBeNull();
  });

  it("returns null when there's no target date at all", () => {
    expect(deriveEventWindow(goal({ targetDate: null }))).toBeNull();
  });
});

describe("weeksUntilEvent", () => {
  it("computes whole weeks remaining", () => {
    const window = deriveEventWindow(goal({ targetDate: "2026-10-15" }))!;
    expect(weeksUntilEvent(window, new Date(2026, 9, 1))).toBe(2);
  });

  it("goes negative once the event has passed", () => {
    const window = deriveEventWindow(goal({ targetDate: "2026-09-01" }))!;
    expect(weeksUntilEvent(window, new Date(2026, 9, 1))).toBeLessThan(0);
  });
});

describe("isWithinTaperWindow", () => {
  it("is true inside the taper window", () => {
    const window = deriveEventWindow(goal({ targetDate: "2026-10-08" }))!; // 1 week out
    expect(isWithinTaperWindow(window, new Date(2026, 9, 1), 2)).toBe(true);
  });

  it("is false further out than the taper window", () => {
    const window = deriveEventWindow(goal({ targetDate: "2026-11-01" }))!;
    expect(isWithinTaperWindow(window, new Date(2026, 9, 1), 2)).toBe(false);
  });

  it("is still true on race week itself", () => {
    const window = deriveEventWindow(goal({ targetDate: "2026-10-01" }))!;
    expect(isWithinTaperWindow(window, new Date(2026, 9, 1), 2)).toBe(true);
  });
});
