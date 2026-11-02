import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DUPLICATE_MAX_WEEKS, duplicateSummary, menuPosition } from "./session-menu";
import { isClockTime, planBookingMove } from "./booking-move";
import { movedEmail } from "./client-notice-email";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const LA = "America/Los_Angeles";

describe("the calendar's session menu (Ron, Nov 2)", () => {
  it("opens at the pointer, pulled back inside the screen near an edge", () => {
    expect(menuPosition(100, 120, 1280, 800)).toEqual({ left: 100, top: 120 });
    expect(menuPosition(1270, 790, 1280, 800)).toEqual({ left: 1280 - 224 - 8, top: 800 - 200 - 8 });
    expect(menuPosition(2, 2, 375, 812)).toEqual({ left: 8, top: 8 });
  });

  it("Duplicate says what it books, up to 52 weeks", () => {
    expect(DUPLICATE_MAX_WEEKS).toBe(52);
    expect(duplicateSummary("2026-11-09", "9:00 AM", 1)).toBe("Books 1 session: Mon, Nov 9, 9:00 AM.");
    expect(duplicateSummary("2026-11-09", "9:00 AM", 4)).toBe("Books 4 sessions, every week at 9:00 AM: Mon, Nov 9 to Mon, Nov 30.");
    expect(duplicateSummary("2026-11-09", "9:00 AM", 52)).toContain("Mon, Nov 1");
  });

  it("Reschedule can change the time as well as the day, on the coach's clock", () => {
    const booking = { startAt: "2026-11-02T17:00:00.000Z", endAt: "2026-11-02T18:00:00.000Z", status: "confirmed", attendedAt: null, creditState: "unsettled" };
    const now = new Date("2026-11-01T12:00:00Z");
    const plan = planBookingMove({ booking, newDateKey: "2026-11-04", newTime: "14:30", timezone: LA, now });
    expect(plan).toEqual({ ok: true, startIso: "2026-11-04T22:30:00.000Z", endIso: "2026-11-04T23:30:00.000Z" });
    expect(planBookingMove({ booking, newDateKey: "2026-11-04", timezone: LA, now }).startIso).toBe("2026-11-04T17:00:00.000Z");
    expect(planBookingMove({ booking, newDateKey: "2026-11-04", newTime: "25:00", timezone: LA, now })).toEqual({ ok: false, message: "That is not a real time." });
    expect(isClockTime("09:05")).toBe(true);
    expect(isClockTime("9:05")).toBe(false);
  });

  it("a moved session tells the client the new time", () => {
    const m = movedEmail({ coachName: "Ron Arnold", when: "Wed, Nov 4, 2:30 PM", groupId: "g1" });
    expect(m.subject).toBe("Session moved: Wed, Nov 4, 2:30 PM");
    expect(m.text).toContain("Your session with Ron is now Wed, Nov 4, 2:30 PM.");
    const route = read("app/api/bookings/move/route.ts");
    expect(route).toContain("newTime: body?.newTime");
    expect(route).toContain("if (body?.notify === true && future)");
    expect(route).toContain('"Session moved"');
  });

  it("is on every calendar view that shows a client's session, and the phone opens it with a press and hold", () => {
    const menu = read("components/coach/session-menu.tsx");
    expect(menu).toContain("onContextMenu");
    expect(menu).toContain('if (e.pointerType !== "touch") return;');
    expect(menu).toContain("LONG_PRESS_MS");
    // Duplicate starts at the same time next week; more than one week goes through the weekly booking (one notice to the client)
    expect(menu).toContain("useState(addDaysToKey(now.dateKey, 7))");
    expect(menu).toContain('mode: "fixed", count: weeks');
    expect(menu).toContain("newTime: time, notify: true");
    for (const f of ["components/coach/desktop/calendar-grid.tsx", "components/coach/desktop/day-time-grid.tsx", "components/coach/desktop/day-hour-grid.tsx"]) expect(read(f), f).toContain("sessionMenu.handlersFor(");
    expect(read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx")).toContain("<SessionMenuTarget");
  });
});
