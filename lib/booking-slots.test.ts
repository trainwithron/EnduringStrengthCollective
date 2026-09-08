import { describe, it, expect } from "vitest";
import { generateSlotsForDate, resolveBlockedRangesForDate } from "./booking-slots";

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

  it("excludes a slot that overlaps a blocked range", () => {
    const day = new Date("2026-09-08T00:00:00"); // Tuesday
    const slots = generateSlotsForDate(
      day,
      [{ weekday: 2, startTime: "17:00", endTime: "20:00", slotDurationMinutes: 60 }],
      [{ start: new Date("2026-09-08T18:00:00"), end: new Date("2026-09-08T19:00:00") }]
    );
    expect(slots.map((s) => s.start.getHours())).toEqual([17, 19]);
  });
});

describe("resolveBlockedRangesForDate", () => {
  it("clips a multi-day one-off block to just this date's bounds", () => {
    const ranges = resolveBlockedRangesForDate(new Date("2026-09-09T00:00:00"), [
      {
        kind: "one_off",
        startAt: "2026-09-08T12:00:00",
        endAt: "2026-09-11T09:00:00",
        weekday: null,
        startTime: null,
        endTime: null,
      },
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start.getHours()).toBe(0);
    expect(ranges[0].end.getHours()).toBe(0);
    expect(ranges[0].end.getDate()).toBe(10);
  });

  it("ignores a one-off block that doesn't touch this date", () => {
    const ranges = resolveBlockedRangesForDate(new Date("2026-09-09T00:00:00"), [
      {
        kind: "one_off",
        startAt: "2026-09-01T00:00:00",
        endAt: "2026-09-02T00:00:00",
        weekday: null,
        startTime: null,
        endTime: null,
      },
    ]);
    expect(ranges).toHaveLength(0);
  });

  it("resolves a recurring block only on its matching weekday", () => {
    const tuesday = new Date("2026-09-08T00:00:00");
    const wednesday = new Date("2026-09-09T00:00:00");
    const recurring = {
      kind: "recurring" as const,
      startAt: null,
      endAt: null,
      weekday: 2,
      startTime: "12:00",
      endTime: "13:00",
    };
    expect(resolveBlockedRangesForDate(tuesday, [recurring])).toHaveLength(1);
    expect(resolveBlockedRangesForDate(wednesday, [recurring])).toHaveLength(0);
  });
});
