import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bookingCreditLine } from "./booking-credit-line";

// FIX 3 item 4 (needs migration 0428: resolve_no_show(p_booking_id uuid, p_charge boolean) returns boolean; create_walk_in_booking(p_session_id uuid) returns uuid).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the day page's no-show", () => {
  const t = read("components/coach/mark-no-show-toggle.tsx");
  it("Mark no-show asks Charge 1 session or Waive; Undo gives back only what it took", () => {
    expect(t).toContain('rpc("resolve_no_show", { p_booking_id: bookingId, p_charge: charge })');
    expect(t).toContain("onClick={() => mark(true)}");
    expect(t).toContain("onClick={() => mark(false)}");
    expect(t).toContain('rpc("set_booking_no_show", { p_booking_id: bookingId, p_no_show: false })');
    expect(t).not.toContain("p_no_show: next");
  });
});

describe("a walk-in", () => {
  const c = read("components/session/complete-workout-button.tsx");
  it("a coach finishing a client's workout with no booking is asked once; Yes books it and uses 1 session, No takes nothing", () => {
    expect(c).toContain('.from("athlete_sessions").select("booking_id, started_at, completed_at").eq("id", sessionId).maybeSingle();');
    expect(c).toContain("if (row && !row.booking_id && row.started_at) {");
    expect(c).toContain("Put this on your calendar? {time(walkIn.startIso)} to {time(walkIn.endIso)} today. Uses 1 session.");
    expect(c).toContain('rpc("create_walk_in_booking", { p_session_id: sessionId })');
    expect(c).toContain("onClick={() => finishNavigation(walkIn.navHref)}");
  });
  it("only in coach mode (a client's own workout is never a walk-in)", () => {
    expect(c.indexOf("if (coachMode) {\n      const { data: done }")).toBeGreaterThan(-1);
  });
  it("an overlap says so and nothing is used", () => {
    expect(c).toContain("That time overlaps another session on your calendar, so nothing was added and nothing was used.");
  });
});

describe("the start line for a session paid at booking", () => {
  it("says nothing more comes off", () => {
    expect(bookingCreditLine(new Date("2026-10-20T22:00:00Z"), "Sawyer Steele", true, "America/Los_Angeles")).toBe("This is the 3:00 PM session; it was paid for when it was booked, so nothing more comes off.");
    expect(bookingCreditLine(new Date("2026-10-20T22:00:00Z"), "Sawyer Steele", false, "America/Los_Angeles")).toBe("This is the 3:00 PM session; it comes off Sawyer's sessions when you finish.");
  });
});
