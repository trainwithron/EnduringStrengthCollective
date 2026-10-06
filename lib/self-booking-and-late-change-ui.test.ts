import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Guards for Ron's booking rules (Oct 6): clients book themselves only when the coach switches it on, and a late cancel or move is flagged for the
// coach, never taken automatically. The rules themselves are enforced in the database (rehearsals 0277 and 0278); these keep the screens honest.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("client booking screens follow the self-booking switch", () => {
  for (const p of ["../app/groups/[groupId]/calendar/[date]/page.tsx", "../app/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
    it(`${p.split("/").slice(-4, -1).join("/")} hides open times when the switch is off`, () => {
      const src = read(p);
      expect(src).toContain("self_booking_enabled");
      expect(src).toContain("Your coach schedules your sessions");
    });
  }
  it("the coach has the switch on the Availability page", () => {
    expect(read("../app/groups/[groupId]/availability/page.tsx")).toContain("SelfBookingToggle");
    expect(read("../components/coach/desktop/self-booking-toggle.tsx")).toContain("self_booking_enabled: next");
  });
});

describe("a late change is never described to the client as a session taken", () => {
  it("the cancel confirmation says the coach decides", () => {
    const src = read("../components/athlete/cancel-booking-button.tsx");
    expect(src).toContain("decides whether it counts as a session");
    expect(src).not.toContain("will still count as used");
  });
  it("the two reschedule banners say the coach decides", () => {
    for (const p of ["../app/groups/[groupId]/calendar/[date]/page.tsx", "../app/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      const src = read(p);
      expect(src).toContain("they decide whether it counts as a session");
      expect(src).not.toContain("still uses 1 session");
    }
  });
});

describe("the coach decides flagged changes", () => {
  it("the panel calls resolve_late_change with Charge and Waive and is on the dashboard and the phone Home", () => {
    const panel = read("../components/coach/late-changes-panel.tsx");
    expect(panel).toContain("resolve_late_change");
    expect(panel).toContain("Charge");
    expect(panel).toContain("Waive");
    expect(read("../app/dashboard/page.tsx")).toContain("<LateChangesPanel />");
    expect(read("../components/coach/mobile/coach-mobile-home.tsx")).toContain("<LateChangesPanel />");
  });
});

describe("a client's move is a request while self-booking is off", () => {
  it("both booking-day pages pass requestOnly and the button asks through request_booking_move", () => {
    for (const p of ["../app/groups/[groupId]/calendar/[date]/page.tsx", "../app/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      expect(read(p)).toContain("requestOnly={!selfBookingEnabled}");
    }
    const button = read("../components/athlete/reschedule-slot-button.tsx");
    expect(button).toContain("request_booking_move");
    expect(button).toContain("Your coach will confirm your new time");
  });
  it("the coach panel confirms or declines through resolve_move_request", () => {
    const panel = read("../components/coach/late-changes-panel.tsx");
    expect(panel).toContain("resolve_move_request");
    expect(panel).toContain("Confirm");
    expect(panel).toContain("Decline");
  });
});
