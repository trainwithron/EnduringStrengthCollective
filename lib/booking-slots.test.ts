import { describe, it, expect } from "vitest";
import {
  generateSlotsForDate,
  resolveBlockedRangesForDate,
  minimumNoticeBlockedRange,
  isSlotBufferBlocked,
} from "./booking-slots";

// Every test passes "UTC" explicitly and asserts with getUTCHours()/
// getUTCDate() — the output Date objects are absolute instants regardless
// of timezone, but getHours()/getDate() read them back in the *test
// runner's own* local zone, which is environment-dependent and not what
// these tests mean to check. "UTC" also makes the zero-offset case the
// simplest one to hand-verify; the dedicated timezone-conversion tests
// below cover a real non-UTC coach explicitly.
describe("generateSlotsForDate", () => {
  it("generates back-to-back slots within one window", () => {
    // Tuesday 2026-09-08, 5:00pm-8:00pm, 60-minute slots.
    const slots = generateSlotsForDate(
      new Date("2026-09-08T00:00:00"),
      [{ weekday: 2, startTime: "17:00", endTime: "20:00", slotDurationMinutes: 60 }],
      [],
      "UTC"
    );
    expect(slots).toHaveLength(3);
    expect(slots[0].start.getUTCHours()).toBe(17);
    expect(slots[2].start.getUTCHours()).toBe(19);
  });

  it("ignores windows for other weekdays", () => {
    const slots = generateSlotsForDate(
      new Date("2026-09-08T00:00:00"),
      [{ weekday: 3, startTime: "17:00", endTime: "20:00", slotDurationMinutes: 60 }],
      [],
      "UTC"
    );
    expect(slots).toHaveLength(0);
  });

  it("doesn't generate a slot that would run past the window's end", () => {
    // 90 minutes doesn't fit twice into a 2-hour window.
    const slots = generateSlotsForDate(
      new Date("2026-09-08T00:00:00"),
      [{ weekday: 2, startTime: "17:00", endTime: "19:00", slotDurationMinutes: 90 }],
      [],
      "UTC"
    );
    expect(slots).toHaveLength(1);
  });

  it("merges and sorts slots across multiple windows the same day", () => {
    const slots = generateSlotsForDate(
      new Date("2026-09-08T00:00:00"),
      [
        { weekday: 2, startTime: "18:00", endTime: "19:00", slotDurationMinutes: 60 },
        { weekday: 2, startTime: "09:00", endTime: "10:00", slotDurationMinutes: 60 },
      ],
      [],
      "UTC"
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].start.getUTCHours()).toBe(9);
    expect(slots[1].start.getUTCHours()).toBe(18);
  });

  it("excludes a slot that overlaps a blocked range", () => {
    const day = new Date("2026-09-08T00:00:00"); // Tuesday
    const slots = generateSlotsForDate(
      day,
      [{ weekday: 2, startTime: "17:00", endTime: "20:00", slotDurationMinutes: 60 }],
      [{ start: new Date("2026-09-08T18:00:00Z"), end: new Date("2026-09-08T19:00:00Z") }],
      "UTC"
    );
    expect(slots.map((s) => s.start.getUTCHours())).toEqual([17, 19]);
  });

  it("converts a real non-UTC coach timezone correctly (the actual bug this fixes)", () => {
    // A coach's declared "9:00 AM" in US Eastern (winter, EST = UTC-5)
    // must land on 14:00 UTC, regardless of what machine/server renders
    // the page — this is the exact case that used to silently read as
    // 9:00 AM UTC on every server-rendered booking page.
    const slots = generateSlotsForDate(
      new Date("2026-01-13T00:00:00"), // a Tuesday
      [{ weekday: 2, startTime: "09:00", endTime: "10:00", slotDurationMinutes: 60 }],
      [],
      "America/New_York"
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].start.toISOString()).toBe("2026-01-13T14:00:00.000Z");
  });

  it("defaults to a real timezone rather than the runtime's own local zone when none is passed", () => {
    const slots = generateSlotsForDate(new Date("2026-01-13T00:00:00"), [
      { weekday: 2, startTime: "09:00", endTime: "10:00", slotDurationMinutes: 60 },
    ]);
    // Should match the explicit America/New_York case above (the default),
    // not whatever timezone happens to run this test.
    expect(slots[0].start.toISOString()).toBe("2026-01-13T14:00:00.000Z");
  });
});

describe("resolveBlockedRangesForDate", () => {
  it("clips a multi-day one-off block to just this date's bounds", () => {
    const ranges = resolveBlockedRangesForDate(
      new Date("2026-09-09T00:00:00"),
      [
        {
          kind: "one_off",
          startAt: "2026-09-08T12:00:00Z",
          endAt: "2026-09-11T09:00:00Z",
          weekday: null,
          startTime: null,
          endTime: null,
        },
      ],
      "UTC"
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start.getUTCHours()).toBe(0);
    expect(ranges[0].end.getUTCHours()).toBe(0);
    expect(ranges[0].end.getUTCDate()).toBe(10);
  });

  it("ignores a one-off block that doesn't touch this date", () => {
    const ranges = resolveBlockedRangesForDate(
      new Date("2026-09-09T00:00:00"),
      [
        {
          kind: "one_off",
          startAt: "2026-09-01T00:00:00Z",
          endAt: "2026-09-02T00:00:00Z",
          weekday: null,
          startTime: null,
          endTime: null,
        },
      ],
      "UTC"
    );
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
    expect(resolveBlockedRangesForDate(tuesday, [recurring], "UTC")).toHaveLength(1);
    expect(resolveBlockedRangesForDate(wednesday, [recurring], "UTC")).toHaveLength(0);
  });
});

describe("minimumNoticeBlockedRange", () => {
  it("returns null when there's no notice requirement", () => {
    expect(minimumNoticeBlockedRange(new Date("2026-09-08T00:00:00Z"), 0)).toBeNull();
  });

  it("blocks from now through now + minimumNoticeHours", () => {
    const now = new Date("2026-09-08T00:00:00Z");
    const range = minimumNoticeBlockedRange(now, 24);
    expect(range).not.toBeNull();
    expect(range!.start).toEqual(now);
    expect(range!.end.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });

  it("composes with generateSlotsForDate to exclude too-soon slots", () => {
    const now = new Date("2026-09-08T16:00:00Z"); // Tuesday, before the window opens
    const noticeRange = minimumNoticeBlockedRange(now, 3)!; // blocks [16:00, 19:00)
    const slots = generateSlotsForDate(
      new Date("2026-09-08T00:00:00"),
      [{ weekday: 2, startTime: "17:00", endTime: "22:00", slotDurationMinutes: 60 }],
      [noticeRange],
      "UTC"
    );
    // 17:00 and 18:00 fall entirely inside the blocked window; 19:00 is
    // the exact boundary (the notice window ends at 19:00, so a slot
    // starting there is not blocked) and survives, along with everything after.
    expect(slots.map((s) => s.start.getUTCHours())).toEqual([19, 20, 21]);
  });
});

describe("isSlotBufferBlocked", () => {
  const slotStart = new Date("2026-09-08T18:00:00Z");
  const slotEnd = new Date("2026-09-08T19:00:00Z");

  it("returns false when there's no buffer configured", () => {
    const adjacent = [{ start: new Date("2026-09-08T19:00:00Z"), end: new Date("2026-09-08T20:00:00Z") }];
    expect(isSlotBufferBlocked(slotStart, slotEnd, adjacent, 0)).toBe(false);
  });

  it("flags a slot that starts right after another booking within the buffer", () => {
    // Existing booking ends at 19:00; a 15-minute buffer extends its
    // blocked zone to 19:15 — a slot starting exactly at 19:00 (the old,
    // pre-buffer overlap boundary) is now correctly caught.
    const adjacent = [{ start: new Date("2026-09-08T19:00:00Z"), end: new Date("2026-09-08T20:00:00Z") }];
    expect(isSlotBufferBlocked(new Date("2026-09-08T19:00:00Z"), new Date("2026-09-08T20:00:00Z"), adjacent, 15)).toBe(
      true
    );
  });

  it("does not flag a slot genuinely outside the buffer window", () => {
    const adjacent = [{ start: new Date("2026-09-08T19:00:00Z"), end: new Date("2026-09-08T20:00:00Z") }];
    // Ends at 18:44, more than 15 minutes before the adjacent booking starts.
    expect(isSlotBufferBlocked(new Date("2026-09-08T17:44:00Z"), new Date("2026-09-08T18:44:00Z"), adjacent, 15)).toBe(
      false
    );
  });

  it("is unaffected by an unrelated, non-adjacent booking", () => {
    const distant = [{ start: new Date("2026-09-09T19:00:00Z"), end: new Date("2026-09-09T20:00:00Z") }];
    expect(isSlotBufferBlocked(slotStart, slotEnd, distant, 60)).toBe(false);
  });
});
