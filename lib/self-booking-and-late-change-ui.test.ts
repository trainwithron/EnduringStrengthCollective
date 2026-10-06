import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Guards for Ron's booking rules (Oct 6): each coach picks how clients book (on their own, request and the coach confirms, or the coach schedules
// everyone), and a late cancel or move is flagged for the coach, never taken automatically. The rules are enforced in the database (rehearsals
// 0277, 0278 and 0279); these keep the screens honest.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const dayPages = ["../app/groups/[groupId]/calendar/[date]/page.tsx", "../app/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"];

describe("client booking screens follow the coach's booking mode", () => {
  for (const p of dayPages) {
    it(`${p.split("/").slice(-4, -1).join("/")} reads the mode and follows it`, () => {
      const src = read(p);
      expect(src).toContain("booking_mode");
      expect(src).toContain('bookingMode === "coach_schedules"');
      expect(src).toContain("Your coach schedules your sessions");
      expect(src).toContain('bookingMode === "request" ?');
      expect(src).toContain("<RequestSlotButton");
      expect(src).toContain('requestOnly={bookingMode === "request"}');
    });
  }
  it("the coach picks the mode on the Availability page, with three plainly named options", () => {
    expect(read("../app/groups/[groupId]/availability/page.tsx")).toContain("BookingModeSelect");
    const select = read("../components/coach/desktop/booking-mode-select.tsx");
    expect(select).toContain("Clients book on their own");
    expect(select).toContain("Clients request, I confirm");
    expect(select).toContain("I schedule everyone");
    expect(select).toContain("booking_mode: next");
  });
  it("a request is sent through request_booking and the client is told what happens next", () => {
    const button = read("../components/athlete/request-slot-button.tsx");
    expect(button).toContain("request_booking");
    expect(button).toContain("Your coach will confirm");
  });
});

describe("a late change is never described to the client as a session taken", () => {
  it("the cancel confirmation says the coach decides", () => {
    const src = read("../components/athlete/cancel-booking-button.tsx");
    expect(src).toContain("decides whether it counts as a session");
    expect(src).not.toContain("will still count as used");
  });
  it("the two reschedule banners say the coach decides", () => {
    for (const p of dayPages) {
      const src = read(p);
      expect(src).toContain("they decide whether it counts as a session");
      expect(src).not.toContain("still uses 1 session");
    }
  });
});

describe("the coach decides flagged changes and requests", () => {
  it("the panel calls resolve_late_change and resolve_booking_request and is on the dashboard and the phone Home", () => {
    const panel = read("../components/coach/late-changes-panel.tsx");
    expect(panel).toContain("resolve_late_change");
    expect(panel).toContain("resolve_booking_request");
    for (const word of ["Charge", "Waive", "Confirm", "Decline"]) expect(panel).toContain(word);
    expect(read("../app/dashboard/page.tsx")).toContain("<LateChangesPanel />");
    expect(read("../components/coach/mobile/coach-mobile-home.tsx")).toContain("<LateChangesPanel />");
  });
  it("a client's move asks through request_booking_move in request mode", () => {
    const button = read("../components/athlete/reschedule-slot-button.tsx");
    expect(button).toContain("request_booking_move");
    expect(button).toContain("Your coach will confirm your new time");
  });
  it("lapsed requests are cleaned up by the existing 5-minute waiting-list job", () => {
    expect(read("../app/api/cron/process-booking-waitlist/route.ts")).toContain("expire_stale_booking_requests");
  });
});

describe("a client sees that a request is already waiting", () => {
  it("both booking-day pages label a requested time instead of offering the button again", () => {
    for (const p of dayPages) {
      const src = read(p);
      expect(src).toContain("requestedTimes");
      expect(src).toContain("Requested. Waiting for your coach.");
    }
  });
});
