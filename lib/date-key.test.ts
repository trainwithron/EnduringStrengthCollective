import { describe, it, expect, afterAll } from "vitest";
import { dateFromKey, dateKeyOfParts, localDateKey, monthCellKeys, weekdayOfKey, weekKeys } from "./date-key";
import { dateKeyInZone, zonedTimeToUtc } from "./timezone";

// Ron, Oct 6: a session dropped on "Thursday the 14th" was booked on Thu Oct 15 (14 is a Wednesday). The calendar sent each day to the browser as a Date made on the
// server (UTC midnight); a browser west of UTC reads that as the evening before. These run the same checks under several machine zones.
const ZONES = ["America/Los_Angeles", "UTC", "Pacific/Auckland", "Asia/Kolkata", "Pacific/Kiritimati", "America/St_Johns"];
const original = process.env.TZ;
afterAll(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});

describe.each(ZONES)("a calendar day read on a machine in %s", (zone) => {
  it("keeps its own day number, month and weekday", () => {
    process.env.TZ = zone;
    const d = dateFromKey("2026-10-15");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getDay()]).toEqual([2026, 10, 15, 4]); // Thursday
    expect(localDateKey(d)).toBe("2026-10-15");
    const edge = dateFromKey("2026-10-01");
    expect([edge.getDate(), edge.getDay()]).toEqual([1, 4]); // Thu Oct 1
    const newYear = dateFromKey("2027-01-01");
    expect([newYear.getFullYear(), newYear.getMonth(), newYear.getDate()]).toEqual([2027, 0, 1]);
  });

  it("lays the month out with every day under its own weekday", () => {
    process.env.TZ = zone;
    const cells = monthCellKeys(2026, 9); // October 2026
    expect(cells.slice(0, 4)).toEqual([null, null, null, null]); // the 1st is a Thursday
    expect(cells[4]).toBe("2026-10-01");
    cells.forEach((k, i) => {
      if (k) expect(weekdayOfKey(k)).toBe(i % 7);
    });
    expect(cells.indexOf("2026-10-15") % 7).toBe(4); // under TH
    expect(cells.indexOf("2026-10-14") % 7).toBe(3); // under WE
    expect(cells.filter(Boolean)).toHaveLength(31);
  });

  it("builds the week that holds a day, Sunday first", () => {
    process.env.TZ = zone;
    expect(weekKeys("2026-10-15")).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(weekKeys("2026-11-01")[0]).toBe("2026-11-01");
    expect(weekKeys("2026-12-31")).toContain("2027-01-02");
  });

  it("books a dropped day at the coach's own clock, on the same day", () => {
    process.env.TZ = zone;
    // The coach is in Los Angeles. Dropping the 15th and picking 8:00 AM is 15:00 UTC on the 15th, and it is the 15th again on the coach's clock.
    const start = zonedTimeToUtc("2026-10-15", "08:00", "America/Los_Angeles");
    expect(start.toISOString()).toBe("2026-10-15T15:00:00.000Z");
    expect(dateKeyInZone("America/Los_Angeles", start)).toBe("2026-10-15");
    // An evening session lands on its own day on the coach's clock even though it is the next day in UTC.
    const evening = zonedTimeToUtc("2026-10-15", "18:30", "America/Los_Angeles");
    expect(evening.toISOString()).toBe("2026-10-16T01:30:00.000Z");
    expect(dateKeyInZone("America/Los_Angeles", evening)).toBe("2026-10-15");
    // Around midnight, in a zone east of UTC.
    const earlyAuckland = zonedTimeToUtc("2026-10-15", "00:30", "Pacific/Auckland");
    expect(dateKeyInZone("Pacific/Auckland", earlyAuckland)).toBe("2026-10-15");
  });
});

describe("why a Date sent from the server was wrong", () => {
  it("a midnight-UTC Date for the 15th reads as the 14th (a Wednesday) in Los Angeles", () => {
    process.env.TZ = "America/Los_Angeles";
    const fromServer = new Date(Date.UTC(2026, 9, 15, 0, 0, 0));
    expect(fromServer.getDate()).toBe(14);
    expect(fromServer.getDay()).toBe(3);
    // The key does not have the problem.
    expect(dateFromKey("2026-10-15").getDay()).toBe(4);
  });
  it("has parts that always agree", () => {
    expect(dateKeyOfParts(2026, 9, 5)).toBe("2026-10-05");
    expect(weekdayOfKey("2026-10-14")).toBe(3);
    expect(weekdayOfKey("nonsense")).toBe(-1);
    expect(Number.isNaN(dateFromKey("nonsense").getTime())).toBe(true);
  });
});
