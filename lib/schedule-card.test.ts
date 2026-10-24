import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionsAvailableLine, soonestScheduleDays, scheduleCardHref, loadScheduleCardHref } from "./schedule-card";
import { ScheduleCard } from "@/components/athlete/schedule-card";

// Ron, Oct 19: "something small, that says like credits available, would you like to schedule? ... I just want it to look good in the calendar".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const TZ = "America/Los_Angeles";
// Monday Oct 19 2026, 1:00 PM in Los Angeles.
const NOW = new Date("2026-10-19T20:00:00Z");
const win = (weekday: number, startTime: string, endTime: string, minutes = 60) => ({ weekday, startTime, endTime, slotDurationMinutes: minutes });
const base = { exceptions: [], timezone: TZ, minimumNoticeHours: 0, bufferMinutes: 0, requestMode: false, now: NOW };

describe("Schedule card: the sentence", () => {
  it("says how many sessions are available, and 'No sessions left' at 0", () => {
    expect(sessionsAvailableLine(4)).toBe("4 sessions available");
    expect(sessionsAvailableLine(1)).toBe("1 session available");
    expect(sessionsAvailableLine(0)).toBe("No sessions left");
  });
  it("the card is one line and a Schedule button (shown at 0 too)", () => {
    const html = renderToStaticMarkup(createElement(ScheduleCard, { available: 0, href: "/groups/g/calendar/2026-10-21" }));
    expect(html).toContain("No sessions left");
    expect(html).toContain('href="/groups/g/calendar/2026-10-21"');
    expect(html).toContain(">Schedule</a>");
  });
});

describe("Schedule card: the soonest open day", () => {
  it("opens the soonest day in the next 14 with an open time", () => {
    expect(soonestScheduleDays({ ...base, windows: [win(3, "09:00", "10:00")] }).openDay).toBe("2026-10-21");
  });
  it("today counts only while a time is still ahead", () => {
    expect(soonestScheduleDays({ ...base, windows: [win(1, "14:00", "15:00")] }).openDay).toBe("2026-10-19");
    expect(soonestScheduleDays({ ...base, windows: [win(1, "09:00", "10:00")] }).openDay).toBe("2026-10-26");
  });
  it("skips the coach's time off and the minimum notice", () => {
    const off = [{ kind: "one_off" as const, startAt: "2026-10-21T00:00:00Z", endAt: "2026-10-22T12:00:00Z", weekday: null, startTime: null, endTime: null }];
    expect(soonestScheduleDays({ ...base, windows: [win(3, "09:00", "10:00")], exceptions: off }).openDay).toBe("2026-10-28");
    expect(soonestScheduleDays({ ...base, windows: [win(2, "09:00", "10:00")], minimumNoticeHours: 48 }).openDay).toBe("2026-10-27");
  });
  it("with nothing open in 14 days: the soonest day to ask for a different time (request mode), else Messages", () => {
    const lunch = [{ kind: "recurring" as const, startAt: null, endAt: null, weekday: 3, startTime: "09:00", endTime: "09:10" }];
    const days = soonestScheduleDays({ ...base, windows: [win(3, "09:00", "10:30")], exceptions: lunch, requestMode: true });
    expect(days).toEqual({ openDay: null, requestDay: "2026-10-21" });
    expect(scheduleCardHref(days, "/groups/g/calendar", "/groups/g/messages")).toBe("/groups/g/calendar/2026-10-21#request-different-time");
    expect(soonestScheduleDays({ ...base, windows: [win(3, "09:00", "10:30")], exceptions: lunch }).requestDay).toBeNull();
    expect(scheduleCardHref({ openDay: null, requestDay: null }, "/groups/g/calendar", "/groups/g/messages")).toBe("/groups/g/messages");
    expect(scheduleCardHref({ openDay: "2026-10-21", requestDay: null }, "/groups/g/calendar", "/groups/g/messages")).toBe("/groups/g/calendar/2026-10-21");
  });
  it("the different-time control has the anchor and opens when linked to", () => {
    const src = read("components/athlete/request-different-time.tsx");
    expect(src).toContain('id="request-different-time"');
    expect(src).toContain('window.location.hash === "#request-different-time"');
  });
});

describe("Schedule card: where it shows", () => {
  it("hidden when the coach schedules everyone (nothing is read)", async () => {
    const boom = { from: () => { throw new Error("should not query"); } };
    expect(await loadScheduleCardHref(boom, { coachId: "c", timezone: TZ, bookingMode: "coach_schedules", dayBase: "/x", messagesHref: "/m" })).toBeNull();
  });
  it("hidden when the coach has no open hours", async () => {
    const empty = { from: () => { const q: any = { select: () => q, eq: () => q, in: () => q, maybeSingle: async () => ({ data: null }), then: (r: any) => r({ data: [] }) }; return q; } };
    expect(await loadScheduleCardHref(empty, { coachId: "c", timezone: TZ, bookingMode: "free", dayBase: "/x", messagesHref: "/m" })).toBeNull();
  });
  for (const p of ["components/coach/calendar-page-body.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx"]) {
    it(`${p}: the card replaces the separate sessions line, and BookingModeLine stays for coach_schedules`, () => {
      const src = read(p);
      // with the "Fully booked this week" line under it when the coach's cap is reached (Oct 23)
      expect(src).toContain("<ScheduleCard available={creditPicture.toBook} href={scheduleHref.href} note={scheduleHref.note} />");
      expect(src).toMatch(/coachMembership && !scheduleHref && \(\n\s*<p className="font-body text-xs text-steel mt-3">\n\s*\{clientCreditPictureLine\(creditPicture, NO_SESSIONS_LINE\)\}/);
      expect(src).toContain('bookingMode === "coach_schedules" && <BookingModeLine groupId={params.groupId} />');
      expect(src).toContain("hasAvailability\n");
    });
  }
});
