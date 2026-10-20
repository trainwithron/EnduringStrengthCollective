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
  it("is not offered on a session marked happened (only its Undo), and no Mark attended on a no-show", () => {
    const day = read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx");
    expect(day).toContain("!settlementById.get(booking.id)?.attended_at && <MarkNoShowToggle bookingId={booking.id} initialNoShow={booking.no_show ?? false} />");
    expect(day).toContain("{settlementById.has(booking.id) && !booking.no_show && start.getTime() <= Date.now() + 12 * 3600 * 1000 && (");
  });
  it("the did-it-happen cards only ever list sessions not yet marked happened", () => {
    expect(read("components/coach/session-check-section.tsx")).toContain('.is("attended_at", null)');
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
  it("only in coach mode (a client's own workout is never a walk-in), and never in a team-sport group (no sessions there)", () => {
    expect(c.indexOf("if (coachMode?.offerWalkIn) {\n      const { data: done }")).toBeGreaterThan(-1);
    const page = read("app/sessions/[sessionId]/page.tsx");
    expect(page).toContain('supabase.from("groups").select("gamification_enabled, team_mode")');
    expect(page).toContain("offerWalkIn: !isTeamSportGroup((groupRow as { team_mode?: boolean | null } | null)?.team_mode)");
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
