import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countLine, countRanges, countSessionsInRange, sessionWord } from "@/lib/session-counts";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Today is Mon Oct 19, 2026. The grid draws weeks Sunday to Saturday, so this week is Sun Oct 18 to Sat Oct 24.
describe("which week and month are counted", () => {
  it("month view of the current month: this week and this month", () => {
    const r = countRanges({ view: "month", year: 2026, monthIndex: 9, weekStartKey: null, todayKey: "2026-10-19" });
    expect(r).toMatchObject({ weekFromKey: "2026-10-18", weekToKey: "2026-10-25", monthFromKey: "2026-10-01", monthToKey: "2026-11-01", weekIsCurrent: true, monthIsCurrent: true });
    expect(countLine(r, 9, 38)).toBe("This week: 9 sessions · This month: 38 sessions");
  });
  it("month view of another month: the month by name, and the week that holds the 1st", () => {
    const r = countRanges({ view: "month", year: 2026, monthIndex: 10, weekStartKey: null, todayKey: "2026-10-19" });
    expect(r).toMatchObject({ weekFromKey: "2026-11-01", monthFromKey: "2026-11-01", monthToKey: "2026-12-01", weekIsCurrent: false, monthIsCurrent: false });
    expect(countLine(r, 0, 1)).toBe("Week of Nov 1: 0 sessions · November: 1 session");
  });
  it("week view moves with the week: the week on screen and the month that holds its middle", () => {
    const r = countRanges({ view: "week", year: 2026, monthIndex: 9, weekStartKey: "2026-10-25", todayKey: "2026-10-19" });
    expect(r).toMatchObject({ weekFromKey: "2026-10-25", weekToKey: "2026-11-01", monthFromKey: "2026-10-01", weekIsCurrent: false, monthIsCurrent: true });
    expect(countLine(r, 4, 38)).toBe("Week of Oct 25: 4 sessions · This month: 38 sessions");
    // a week that crosses into the next month belongs to the month that holds most of it
    expect(countRanges({ view: "week", year: 2026, monthIndex: 9, weekStartKey: "2026-11-01", todayKey: "2026-10-19" }).monthFromKey).toBe("2026-11-01");
    expect(countRanges({ view: "week", year: 2026, monthIndex: 9, weekStartKey: "2026-12-27", todayKey: "2026-10-19" }).monthFromKey).toBe("2026-12-01");
    expect(countRanges({ view: "month", year: 2026, monthIndex: 11, weekStartKey: null, todayKey: "2026-10-19" }).monthToKey).toBe("2027-01-01");
  });
  it("singular and plural", () => {
    expect(sessionWord(1)).toBe("1 session");
    expect(sessionWord(0)).toBe("0 sessions");
  });
});

function fake(counts: { bookings: number; items: number; standIns: number }, fail = false) {
  return {
    from: (table: string) => {
      let standIn = false;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        not: () => ((standIn = true), chain),
        lt: async () => ({ count: fail ? null : table === "bookings" ? counts.bookings : standIn ? counts.standIns : counts.items, error: fail ? { message: "x" } : null }),
      };
      return chain;
    },
  };
}

describe("counting what the grid shows", () => {
  it("confirmed sessions plus group items, once each (a group item's hidden stand-in booking is not counted twice)", async () => {
    expect(await countSessionsInRange(fake({ bookings: 12, items: 3, standIns: 2 }), "c", ["g1"], "2026-10-01", "2026-11-01", "America/Los_Angeles")).toBe(13);
  });
  it("a failed read shows no number rather than a wrong one", async () => {
    expect(await countSessionsInRange(fake({ bookings: 0, items: 0, standIns: 0 }, true), "c", ["g1"], "2026-10-01", "2026-11-01", "America/Los_Angeles")).toBeNull();
  });
  it("only confirmed sessions and scheduled items, only the open organization's groups, on the coach's clock", () => {
    const src = read("lib/session-counts.ts");
    expect(src).toContain('.eq("status", "confirmed")');
    expect(src).toContain('.eq("status", "scheduled")');
    expect(src.match(/\.in\("group_id", g\)/g)?.length).toBe(3);
    expect(src).toContain('zonedTimeToUtc(fromKey, "00:00", timezone)');
  });
  it("is the line at the top of the Calendar, on a computer and on a phone, and moves with the week and month", () => {
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body.match(/<SessionCountLine/g)?.length).toBe(1);
    expect(read("components/coach/mobile/coach-phone-schedule.tsx")).toContain("<SessionCountLine coachId={userId} groupIds={orgGroupIds} timezone={timezone} view=\"month\" year={year} monthIndex={monthIndex} weekStartKey={null} />");
    expect(body).toContain('view={view} year={year} monthIndex={monthIndex} weekStartKey={dateKey(weekStart)}');
    expect(body.indexOf("<SessionCountLine")).toBeLessThan(body.indexOf("<SessionCheckSection"));
  });
});
