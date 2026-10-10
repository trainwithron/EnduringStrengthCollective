import { describe, it, expect } from "vitest";
import { planRunOut, rowFirstDateKey, rowWeekday, type RowDate } from "@/lib/series-multi";
import { addDaysToDateKey, firstDateOnOrAfter, generateFixedOccurrences, weekdayOfDateKey } from "@/lib/series-schedule";

// 2026-10-12 is a Monday.
const MONDAY = "2026-10-12";

function dates(firstDateKey: string, time: string, weeks = 52, blockingIdx: number[] = []): RowDate[] {
  return generateFixedOccurrences({ firstDateKey, startTime: time, timezone: "America/Los_Angeles", durationMinutes: 60, count: weeks }).map((o, i) => ({
    startIso: o.start.toISOString(),
    blocking: blockingIdx.includes(i),
  }));
}

describe("where a day row starts", () => {
  it("a row with no weekday starts on the Starting date itself (the old single form)", () => {
    expect(rowFirstDateKey(MONDAY, null)).toBe(MONDAY);
    expect(rowWeekday(MONDAY, null)).toBe(1);
  });
  it("a row with a weekday starts on the first such day on or after the Starting date", () => {
    expect(rowFirstDateKey(MONDAY, 1)).toBe(MONDAY);
    expect(rowFirstDateKey(MONDAY, 4)).toBe("2026-10-15");
    expect(rowFirstDateKey(MONDAY, 0)).toBe("2026-10-18");
    expect(weekdayOfDateKey(rowFirstDateKey(MONDAY, 4))).toBe(4);
    expect(rowFirstDateKey(MONDAY, 4)).toBe(firstDateOnOrAfter(MONDAY, 4));
  });
});

describe("until their sessions run out", () => {
  const monday = dates(MONDAY, "06:00");
  const thursday = dates(addDaysToDateKey(MONDAY, 3), "15:00");

  it("books exactly as many dates as the client has sessions left, across rows, in date order", () => {
    const plan = planRunOut([monday, thursday], new Set(), 5);
    expect(plan.booked).toHaveLength(5);
    expect([...plan.booked].sort()).toEqual(plan.booked);
    // Mon, Thu, Mon, Thu, Mon: three Mondays and two Thursdays.
    expect(plan.rows.map((r) => r.count)).toEqual([3, 2]);
    expect(plan.rows.every((r) => r.skipStartsIso.length === 0)).toBe(true);
    expect(plan.booked[0]).toBe(monday[0].startIso);
    expect(plan.booked[1]).toBe(thursday[0].startIso);
  });

  it("two rows with different times keep their own times (6:00 AM and 3:00 PM) and first dates", () => {
    const plan = planRunOut([monday, thursday], new Set(), 2);
    expect(plan.booked).toEqual([monday[0].startIso, thursday[0].startIso]);
    expect(new Date(monday[0].startIso).getTime()).not.toBe(new Date(thursday[0].startIso).getTime());
  });

  it("a single row books balance dates", () => {
    const plan = planRunOut([monday], new Set(), 8);
    expect(plan.booked).toHaveLength(8);
    expect(plan.rows).toEqual([{ count: 8, skipStartsIso: [] }]);
  });

  it("an unticked date pulls the next one in, so the total stays at the sessions left", () => {
    const plan = planRunOut([monday, thursday], new Set([thursday[0].startIso]), 4);
    expect(plan.booked).toHaveLength(4);
    expect(plan.booked).not.toContain(thursday[0].startIso);
    expect(plan.shown.some((s) => s.startIso === thursday[0].startIso)).toBe(true);
    expect(plan.rows[1].skipStartsIso).toEqual([thursday[0].startIso]);
  });

  it("a date that cannot be booked (already taken) is shown but not counted", () => {
    const m = dates(MONDAY, "06:00", 52, [0]);
    const plan = planRunOut([m], new Set(), 3);
    expect(plan.booked).toHaveLength(3);
    expect(plan.booked).not.toContain(m[0].startIso);
    expect(plan.rows[0].skipStartsIso).toEqual([m[0].startIso]);
    expect(plan.rows[0].count).toBe(4);
  });

  it("never goes past 52 weeks, even with more sessions left than that", () => {
    const plan = planRunOut([monday], new Set(), 500);
    expect(plan.booked).toHaveLength(52);
    expect(plan.rows[0].count).toBe(52);
    const two = planRunOut([monday, thursday], new Set(), 500);
    expect(two.booked).toHaveLength(104);
    expect(two.rows.map((r) => r.count)).toEqual([52, 52]);
  });

  it("nothing left means nothing booked and no series made", () => {
    const plan = planRunOut([monday, thursday], new Set(), 0);
    expect(plan.booked).toEqual([]);
    expect(plan.rows.map((r) => r.count)).toEqual([0, 0]);
    expect(planRunOut([monday], new Set(), -3).booked).toEqual([]);
  });

  it("a row that is never reached makes no series", () => {
    const plan = planRunOut([monday, dates(addDaysToDateKey(MONDAY, 5), "09:00")], new Set(), 1);
    expect(plan.rows.map((r) => r.count)).toEqual([1, 0]);
  });
});
