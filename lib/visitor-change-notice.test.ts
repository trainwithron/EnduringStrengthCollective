import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visitorChangeNotice } from "@/lib/visitor-change-notice";

const route = readFileSync("app/api/public-booking/manage/[token]/route.ts", "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: a visitor cancelling or moving via their private link never told the coach, though the booking itself did.
describe("the coach's note about a visitor's change", () => {
  it("a cancellation", () => {
    expect(visitorChangeNotice({ kind: "cancelled", guestName: "Dana Lee", typeName: "Intro session", oldWhen: "Wed, Oct 21, 3:00 PM" })).toEqual({ title: "Booking cancelled", body: "Dana Lee cancelled Intro session (Wed, Oct 21, 3:00 PM)." });
  });
  it("a move names both times", () => {
    expect(visitorChangeNotice({ kind: "moved", guestName: "Dana Lee", typeName: null, oldWhen: "Wed, Oct 21, 3:00 PM", newWhen: "Thu, Oct 22, 4:00 PM" })).toEqual({ title: "Booking moved", body: "Dana Lee moved their session from Wed, Oct 21, 3:00 PM to Thu, Oct 22, 4:00 PM." });
  });
  it("an unnamed visitor is 'A visitor'", () => {
    expect(visitorChangeNotice({ kind: "cancelled", guestName: " ", typeName: "X", oldWhen: "t" }).body).toBe("A visitor cancelled X (t).");
  });
});

describe("the manage route", () => {
  it("tells the coach only after the change really happened, through the coach's 'bookings' notice switch, best effort", () => {
    expect(route).toContain("if (r.ok && link) await tellCoach(link, { kind: \"cancelled\" });");
    expect(route).toContain("if (r.ok && link) await tellCoach(link, { kind: \"moved\"");
    expect(route).toContain('sendCoachPush(db, link.coachId, "bookings"');
    expect(route).toContain("} catch {\n    // Quiet.");
  });
  it("reads the booking's link BEFORE the change (a cancelled booking's link is no longer 'confirmed')", () => {
    expect(route.indexOf("const link = await store.linkByHash(hashClaimToken(token));")).toBeLessThan(route.indexOf("await cancelManagedBooking(store, token)"));
  });
});
