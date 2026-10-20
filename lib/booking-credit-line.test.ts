import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bookingCreditLine } from "@/lib/booking-credit-line";

const src = readFileSync("components/logging/start-workout-button.tsx", "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: Ron left "Use 1 session credit" unticked and the client was charged anyway, because the workout was linked to a nearby booking that takes its own session off when it is finished.
describe("the line that replaces the credit box when a booking is linked", () => {
  it("says which session it is and that it comes off their sessions when the workout is finished", () => {
    expect(bookingCreditLine(new Date(2026, 9, 19, 15, 0), "Sawyer Smith")).toBe("This is the 3:00 PM session; it comes off Sawyer's sessions when you finish.");
    expect(bookingCreditLine(new Date(2026, 9, 19, 8, 5))).toBe("This is the 8:05 AM session; it comes off their sessions when you finish.");
  });
});

describe("the start button", () => {
  it("FIX 3: no credit box at all; the line when a booking is linked (prepaid says nothing more comes off), nothing when none is", () => {
    expect(src).toContain("{loggedByCoach && linked && (");
    expect(src).toContain("{bookingCreditLine(linked.startAt, clientName, linked.prepaid, coachTimezone)}");
    expect(src).not.toContain("{loggedByCoach && !linked && (");
    expect(src).not.toContain("Use 1 session credit\n");
    expect(src).not.toContain('type="checkbox"');
  });
  it("never asks the start to take a credit (the finished workout settles its booking once; a walk-in is offered at the end)", () => {
    expect(src).toContain("p_deduct_session_credit: false,");
    expect(src).toContain("deduct_session_credit: false,");
    expect(src).not.toContain("deductCredit");
    expect(src).not.toContain("takeCredit");
  });
  it("finds the booking before Start so the coach is told, and again at Start only if that read had not finished", () => {
    expect(src).toContain("findLinkedBooking(createBrowserClient())");
    expect(src).toContain("(linkChecked ? linked : await findLinkedBooking(supabase))?.id ?? null");
  });
});

describe("linking the client's session of the same day", () => {
  it("looks at today on the COACH's clock, confirmed, unsettled or paid at booking, not a no-show, not attended, and takes the nearest to now", () => {
    expect(src).toContain('.in("credit_state", ["unsettled", "prepaid"])');
    expect(src).toContain('.eq("no_show", false)');
    expect(src).toContain('.is("attended_at", null)');
    expect(src).toContain("const day = localDayBounds(zone, now);");
    expect(src).toContain('.gte("start_at", day.startIso)');
    expect(src).toContain('.lt("start_at", day.endIso)');
    expect(src).toContain("findMatchingBookingId(candidates, now, SAME_DAY_TOLERANCE_MINUTES)");
    expect(src).not.toContain("3 * 60 * 60000");
  });
  it("the nearest of the day's sessions wins; none that day links nothing, so the credit box shows as before", async () => {
    const { findMatchingBookingId, SAME_DAY_TOLERANCE_MINUTES } = await import("@/lib/booking-session-link");
    const now = new Date(2026, 9, 19, 8, 0);
    const morning = { id: "morning", startAt: new Date(2026, 9, 19, 9, 0) };
    const afternoon = { id: "afternoon", startAt: new Date(2026, 9, 19, 15, 0) };
    expect(findMatchingBookingId([afternoon], now, SAME_DAY_TOLERANCE_MINUTES)).toBe("afternoon");
    expect(findMatchingBookingId([afternoon, morning], now, SAME_DAY_TOLERANCE_MINUTES)).toBe("morning");
    expect(findMatchingBookingId([], now, SAME_DAY_TOLERANCE_MINUTES)).toBeNull();
  });
});
