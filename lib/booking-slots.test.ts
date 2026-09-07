import { describe, it, expect } from "vitest";
import { generateSlotsForDate } from "./booking-slots";

describe("generateSlotsForDate", () => {
  it("generates back-to-back slots within one window", () => {
    // Tuesday 2026-09-08, 5:00pm-8:00pm, 60-minute slots.
    const slots = generateSlotsForDate(new Date("2026-09-08T00:00:00"), [
      { weekday: 2, startTime: "17:00", endTime: "20:00", slotDurationMinutes: 60 },
    ]);
    expect(slots).toHaveLength(3);
    expect(slots[0].start.getHours()).toBe(17);
    expect(slots[2].start.getHours()).toBe(19);
  });

  it("ignores windows for other weekdays", () => {
    const slots = generateSlotsForDate(new Date("2026-09-08T00:00:00"), [
      { weekday: 3, startTime: "17:00", endTime: "20:00", slotDurationMinutes: 60 },
    ]);
    expect(slots).toHaveLength(0);
  });

  it("doesn't generate a slot that would run past the window's end", () => {
    // 90 minutes doesn't fit twice into a 2-hour window.
    const slots = generateSlotsForDate(new Date("2026-09-08T00:00:00"), [
      { weekday: 2, startTime: "17:00", endTime: "19:00", slotDurationMinutes: 90 },
    ]);
    expect(slots).toHaveLength(1);
  });

  it("merges and sorts slots across multiple windows the same day", () => {
    const slots = generateSlotsForDate(new Date("2026-09-08T00:00:00"), [
      { weekday: 2, startTime: "18:00", endTime: "19:00", slotDurationMinutes: 60 },
      { weekday: 2, startTime: "09:00", endTime: "10:00", slotDurationMinutes: 60 },
    ]);
    expect(slots).toHaveLength(2);
    expect(slots[0].start.getHours()).toBe(9);
    expect(slots[1].start.getHours()).toBe(18);
  });
});
