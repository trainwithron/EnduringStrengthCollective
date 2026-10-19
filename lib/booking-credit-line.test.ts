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
  it("shows the credit box ONLY when no booking is linked, and the line when one is", () => {
    expect(src).toContain("{loggedByCoach && linked && (");
    expect(src).toContain("{bookingCreditLine(linked.startAt, clientName)}");
    expect(src).toContain("{loggedByCoach && !linked && (");
    expect(src.indexOf("{loggedByCoach && linked && (")).toBeLessThan(src.lastIndexOf("Use 1 session credit"));
  });
  it("never sends a credit to be taken when a booking is linked (the booking takes its own), and the box decides only when there is none", () => {
    expect(src).toContain("const takeCredit = !!loggedByCoach && !bookingId && deductCredit;");
    expect(src).toContain("p_deduct_session_credit: takeCredit,");
    expect(src).toContain("deduct_session_credit: takeCredit,");
    expect(src).not.toContain("!!loggedByCoach && deductCredit,");
  });
  it("finds the booking before Start so the coach is told, and again at Start only if that read had not finished", () => {
    expect(src).toContain("findLinkedBooking(createBrowserClient())");
    expect(src).toContain("(linkChecked ? linked : await findLinkedBooking(supabase))?.id ?? null");
  });
});

describe("linking the client's session of the same day", () => {
  it("looks at today on the coach's clock, confirmed and not yet settled or marked, and takes the nearest to now", () => {
    expect(src).toContain('.eq("credit_state", "unsettled")');
    expect(src).toContain('.is("attended_at", null)');
    expect(src).toContain(".gte(\"start_at\", dayStart.toISOString())");
    expect(src).toContain(".lt(\"start_at\", dayEnd.toISOString())");
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
