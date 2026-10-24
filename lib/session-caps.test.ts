import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { capLine, capToneClass, fetchSlotReasons, fullyBookedLine, keepOffered, limitsActive, limitsFromRow, NO_LIMITS } from "./session-caps";
import { soonestScheduleDays } from "./schedule-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

// Ron, Oct 23: "I need to limit my weekly sessions at 25. I can't go over 100 sessions a month" and "it would recommend the most likely places that I would want to be booked at".
// The database decides (rehearsed in scripts/sql-tests/rehearsal/0432.test.mjs: an empty day offers its first 2 times, a 9 AM session makes 8 and 10 the offers, lunch is never
// offered, a cap refuses a client and not the coach); these are the screens around it.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the coach's limits", () => {
  it("read from the policy row; blank is no limit, and nothing set means the screens offer as before (no extra request)", () => {
    expect(limitsFromRow(null)).toEqual(NO_LIMITS);
    expect(limitsFromRow({ max_sessions_per_week: 25, max_sessions_per_month: 100, keep_together: true, lunch_start: "12:00:00", lunch_end: "13:00:00" })).toEqual({ maxPerWeek: 25, maxPerMonth: 100, keepTogether: true, lunchStart: "12:00:00", lunchEnd: "13:00:00" });
    expect(limitsActive(NO_LIMITS)).toBe(false);
    expect(limitsActive({ ...NO_LIMITS, maxPerWeek: 25 })).toBe(true);
    expect(limitsActive({ ...NO_LIMITS, keepTogether: true })).toBe(true);
    expect(limitsActive({ ...NO_LIMITS, lunchStart: "12:00:00", lunchEnd: "13:00:00" })).toBe(true);
  });
  it("the coach's line: 25 of 25 this week is amber, over it is rust, under it is plain", () => {
    expect(capLine(25, 25, "week")).toEqual({ text: "25 of 25 this week", tone: "amber" });
    expect(capLine(26, 25, "week")?.tone).toBe("rust");
    expect(capLine(98, 100, "month")).toEqual({ text: "98 of 100 this month", tone: "plain" });
    expect(capLine(10, null, "week")).toBeNull();
    expect(capToneClass("amber")).toBe("text-amber");
    expect(capToneClass("rust")).toBe("text-rust");
  });
});

describe("a client is offered only what the server will accept", () => {
  it("keeps the times with no reason; a failed answer keeps all of them (the server still refuses)", () => {
    expect(keepOffered(["6", "7", "8"], [null, "not_offered", null])).toEqual(["6", "8"]);
    expect(keepOffered(["6", "7"], null)).toEqual(["6", "7"]);
  });
  it("says Fully booked this week (or month) when a cap is why nothing is offered", () => {
    expect(fullyBookedLine(["week_full", "week_full"])).toBe("Fully booked this week");
    expect(fullyBookedLine(["week_full", "month_full"])).toBe("Fully booked this month");
    expect(fullyBookedLine(["week_full", null])).toBeNull();
    expect(fullyBookedLine(["not_offered"])).toBeNull();
  });
  it("asks the server once with the times (and the session being moved)", async () => {
    const rpc = vi.fn(async () => ({ data: [null, "lunch"], error: null }));
    const out = await fetchSlotReasons({ rpc }, "c", [{ start: new Date("2026-11-04T14:00:00Z"), end: new Date("2026-11-04T15:00:00Z") }, { start: new Date("2026-11-04T17:00:00Z"), end: new Date("2026-11-04T18:00:00Z") }], "b1");
    expect(out).toEqual([null, "lunch"]);
    expect(rpc).toHaveBeenCalledWith("client_slot_reasons", expect.objectContaining({ p_coach_id: "c", p_ignore_booking_id: "b1" }));
    expect(await fetchSlotReasons({ rpc: async () => ({ data: null, error: { message: "no such function" } }) }, "c", [{ start: new Date(), end: new Date() }])).toBeNull();
  });
  it("the day pages and the Schedule card use it; a coach booking is never limited", () => {
    for (const f of ["app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      const s = read(f);
      expect(s, f).toContain('if (coachMembership && membership.role !== "coach" && bookingMode !== "coach_schedules") {');
      expect(s, f).toContain("reschedulingBooking?.id ?? null");
      expect(s, f).toContain("`${fullyBooked}. Message your coach to ask for a time.`");
    }
    const card = read("lib/schedule-card.ts");
    expect(card).toContain("const reasons = await fetchSlotReasons(supabase, input.coachId, candidates);");
    expect(card).toContain("isOffered,");
  });
  it("the Schedule card's soonest day skips days with nothing offered", () => {
    const windows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "11:00", slotDurationMinutes: 60 }));
    const now = new Date("2026-11-02T12:00:00Z");
    const all = soonestScheduleDays({ windows, exceptions: [], timezone: "UTC", minimumNoticeHours: 0, bufferMinutes: 0, requestMode: false, now });
    const skipFirst = soonestScheduleDays({ windows, exceptions: [], timezone: "UTC", minimumNoticeHours: 0, bufferMinutes: 0, requestMode: false, now, isOffered: (s) => s.toISOString().slice(0, 10) !== all.openDay });
    expect(skipFirst.openDay).not.toBe(all.openDay);
  });
});

describe("the coach's screens", () => {
  it("Calendar > Availability has the limits: per week, per month, keep together, lunch", async () => {
    const { SessionLimitsControl } = await import("@/components/coach/desktop/session-limits-control");
    const html = renderToStaticMarkup(createElement(SessionLimitsControl, { coachId: "c", initial: { maxPerWeek: 25, maxPerMonth: 100, keepTogether: true, lunchStart: "12:00:00", lunchEnd: "13:00:00" } }));
    expect(html).toContain("Most sessions per week");
    expect(html).toContain('value="25"');
    expect(html).toContain("Most sessions per month");
    expect(html).toContain("Keep my sessions together");
    expect(html).toContain('value="12:00"');
    expect(read("components/coach/desktop/availability-settings.tsx")).toContain("{!limitsResult.error && <SessionLimitsControl");
  });
  it("the calendar's count line and the day the coach schedules on show 25 of 25 this week", () => {
    expect(read("components/coach/session-count-line.tsx")).toContain("loadCapLines(supabase, coachId,");
    expect(read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx")).toContain("const capLines = await loadCapLines(supabase, user.id, {");
  });
});
