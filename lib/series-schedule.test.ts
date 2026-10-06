import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  classifyOccurrences,
  firstDateOnOrAfter,
  generateFixedOccurrences,
  isBlockingConflict,
  occurrenceAt,
  ongoingOccurrencesToCreate,
  weekdayOfDateKey,
  withinGoogleMirrorWindow,
} from "@/lib/series-schedule";

const NY = "America/New_York";

describe("date keys", () => {
  it("adds days across month and year ends", () => {
    expect(addDaysToDateKey("2026-10-28", 7)).toBe("2026-11-04");
    expect(addDaysToDateKey("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDaysToDateKey("2028-02-26", 7)).toBe("2028-03-04");
  });

  it("finds weekdays", () => {
    expect(weekdayOfDateKey("2026-10-27")).toBe(2); // Tuesday
    expect(weekdayOfDateKey("2026-10-25")).toBe(0); // Sunday
  });

  it("finds the next matching weekday, including today", () => {
    expect(firstDateOnOrAfter("2026-10-27", 2)).toBe("2026-10-27");
    expect(firstDateOnOrAfter("2026-10-27", 4)).toBe("2026-10-29");
    expect(firstDateOnOrAfter("2026-10-27", 1)).toBe("2026-11-02");
  });
});

describe("wall-clock time is kept across daylight saving", () => {
  it("6:00 stays 6:00 when the clocks fall back", () => {
    const before = occurrenceAt("2026-10-27", "06:00", NY, 60, 0); // EDT, UTC-4
    const after = occurrenceAt("2026-10-27", "06:00", NY, 60, 1); // Nov 3, EST, UTC-5
    expect(before.start.toISOString()).toBe("2026-10-27T10:00:00.000Z");
    expect(after.start.toISOString()).toBe("2026-11-03T11:00:00.000Z");
    expect(after.end.getTime() - after.start.getTime()).toBe(3600000);
  });

  it("6:00 stays 6:00 when the clocks spring forward", () => {
    const before = occurrenceAt("2027-03-02", "06:00", NY, 45, 0); // EST
    const after = occurrenceAt("2027-03-02", "06:00", NY, 45, 2); // Mar 16, EDT
    expect(before.start.toISOString()).toBe("2027-03-02T11:00:00.000Z");
    expect(after.start.toISOString()).toBe("2027-03-16T10:00:00.000Z");
  });

  it("accepts HH:MM:SS times", () => {
    expect(occurrenceAt("2026-10-27", "06:00:00", NY, 60, 0).start.toISOString()).toBe("2026-10-27T10:00:00.000Z");
  });
});

describe("fixed series", () => {
  it("makes one occurrence per week", () => {
    const occ = generateFixedOccurrences({ firstDateKey: "2026-10-27", startTime: "06:00", timezone: NY, durationMinutes: 60, count: 4 });
    expect(occ).toHaveLength(4);
    expect(occ[3].start.toISOString()).toBe("2026-11-17T11:00:00.000Z");
  });

  it("caps at 52 weeks", () => {
    const occ = generateFixedOccurrences({ firstDateKey: "2026-10-27", startTime: "06:00", timezone: NY, durationMinutes: 60, count: 200 });
    expect(occ).toHaveLength(52);
  });

  it("leaves out skipped weeks and can start part way (extend)", () => {
    const occ = generateFixedOccurrences({
      firstDateKey: "2026-10-27",
      startTime: "06:00",
      timezone: NY,
      durationMinutes: 60,
      count: 3,
      startIndex: 4,
      skipIndexes: [5],
    });
    expect(occ).toHaveLength(2);
    expect(occ[0].start.toISOString()).toBe("2026-11-24T11:00:00.000Z");
  });
});

describe("ongoing series: rolling 12-week window", () => {
  const base = {
    anchorDateKey: "2026-10-06", // a Tuesday
    startTime: "06:00",
    timezone: NY,
    durationMinutes: 60,
    existingStarts: new Set<number>(),
    skippedStarts: new Set<number>(),
  };

  it("books up to 12 weeks ahead and nothing in the past", () => {
    const now = new Date("2026-10-13T20:00:00Z"); // Tuesday Oct 13 after 6:00 local
    const occ = ongoingOccurrencesToCreate({ ...base, now });
    // Oct 20 is the first future Tuesday; 12 weeks from Oct 13 reaches Jan 5.
    expect(occ[0].start.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(occ[occ.length - 1].start.getTime()).toBeLessThanOrEqual(now.getTime() + 12 * 7 * 86400000);
    expect(occ).toHaveLength(12);
  });

  it("tops up only what is missing", () => {
    const now = new Date("2026-10-13T20:00:00Z");
    const first = ongoingOccurrencesToCreate({ ...base, now });
    const existing = new Set(first.slice(0, 11).map((o) => o.start.getTime()));
    const topUp = ongoingOccurrencesToCreate({ ...base, now, existingStarts: existing });
    expect(topUp).toHaveLength(1);
    expect(topUp[0].start.getTime()).toBe(first[11].start.getTime());
  });

  it("a week the coach removed on purpose is not booked again", () => {
    const now = new Date("2026-10-13T20:00:00Z");
    const first = ongoingOccurrencesToCreate({ ...base, now });
    const skipped = new Set([first[2].start.getTime()]);
    const again = ongoingOccurrencesToCreate({ ...base, now, skippedStarts: skipped });
    expect(again.some((o) => o.start.getTime() === first[2].start.getTime())).toBe(false);
    expect(again).toHaveLength(11);
  });

  it("stops at the end date", () => {
    const now = new Date("2026-10-13T20:00:00Z");
    const occ = ongoingOccurrencesToCreate({ ...base, now, endsOnDateKey: "2026-11-03" });
    // Oct 20, Oct 27, Nov 3.
    expect(occ).toHaveLength(3);
  });

  it("a shorter window books fewer weeks", () => {
    const now = new Date("2026-10-13T20:00:00Z");
    expect(ongoingOccurrencesToCreate({ ...base, now, windowWeeks: 4 })).toHaveLength(4);
  });
});

describe("conflicts", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const windows = [{ weekday: 2, startTime: "06:00", endTime: "12:00", slotDurationMinutes: 60 }];
  const ctx = { now, busy: [], bufferMinutes: 0, windows, exceptions: [], timezone: NY };

  it("a normal slot inside weekly hours has no conflict", () => {
    const [r] = classifyOccurrences([occurrenceAt("2026-10-20", "06:00", NY, 60, 0)], ctx);
    expect(r.conflict).toBeNull();
  });

  it("the past cannot be booked", () => {
    const [r] = classifyOccurrences([occurrenceAt("2026-10-06", "06:00", NY, 60, 0)], ctx);
    expect(r.conflict).toBe("past");
    expect(isBlockingConflict(r.conflict)).toBe(true);
  });

  it("another session at that time makes it taken", () => {
    const occ = occurrenceAt("2026-10-20", "06:00", NY, 60, 0);
    const [r] = classifyOccurrences([occ], { ...ctx, busy: [{ start: occ.start, end: occ.end }] });
    expect(r.conflict).toBe("taken");
  });

  it("the buffer counts: a session ending 10 minutes earlier clashes with a 15 minute buffer", () => {
    const occ = occurrenceAt("2026-10-20", "07:00", NY, 60, 0);
    const busy = [{ start: new Date(occ.start.getTime() - 70 * 60000), end: new Date(occ.start.getTime() - 10 * 60000) }];
    expect(classifyOccurrences([occ], { ...ctx, busy, bufferMinutes: 15 })[0].conflict).toBe("taken");
    expect(classifyOccurrences([occ], { ...ctx, busy, bufferMinutes: 5 })[0].conflict).toBeNull();
  });

  it("outside weekly hours is a warning, not a block", () => {
    const [r] = classifyOccurrences([occurrenceAt("2026-10-20", "15:00", NY, 60, 0)], ctx);
    expect(r.conflict).toBe("outside_hours");
    expect(isBlockingConflict(r.conflict)).toBe(false);
  });

  it("a session at any minute inside the weekly hours is not flagged (a start at 6:20 or 1:15 is fine), but one that runs past the end is", () => {
    const [off] = classifyOccurrences([occurrenceAt("2026-10-20", "06:20", NY, 55, 0)], ctx);
    expect(off.conflict).toBeNull();
    const [pastEnd] = classifyOccurrences([occurrenceAt("2026-10-20", "11:30", NY, 60, 0)], ctx);
    expect(pastEnd.conflict).toBe("outside_hours");
  });

  it("hours are not flagged when the coach has set none", () => {
    const [r] = classifyOccurrences([occurrenceAt("2026-10-20", "15:00", NY, 60, 0)], { ...ctx, windows: [] });
    expect(r.conflict).toBeNull();
  });

  it("time off is a warning", () => {
    const occ = occurrenceAt("2026-10-20", "06:00", NY, 60, 0);
    const exceptions = [
      { kind: "one_off" as const, startAt: "2026-10-20T00:00:00Z", endAt: "2026-10-21T00:00:00Z", weekday: null, startTime: null, endTime: null },
    ];
    expect(classifyOccurrences([occ], { ...ctx, exceptions })[0].conflict).toBe("time_off");
  });

  it("an evening session is judged on the coach's own day, not the UTC day", () => {
    // 9:00 PM New York on Tuesday is already Wednesday in UTC.
    const windowsEvening = [{ weekday: 2, startTime: "18:00", endTime: "22:00", slotDurationMinutes: 60 }];
    const occ = occurrenceAt("2026-10-20", "21:00", NY, 60, 0);
    expect(occ.start.toISOString()).toBe("2026-10-21T01:00:00.000Z");
    expect(classifyOccurrences([occ], { ...ctx, windows: windowsEvening })[0].conflict).toBeNull();
  });
});

describe("google calendar window", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("mirrors the next 12 weeks only", () => {
    expect(withinGoogleMirrorWindow(new Date(now.getTime() + 11 * 7 * 86400000), now)).toBe(true);
    expect(withinGoogleMirrorWindow(new Date(now.getTime() + 13 * 7 * 86400000), now)).toBe(false);
  });
});
