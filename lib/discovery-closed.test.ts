import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The old discovery-call page is closed (Ron, Oct 6): the id link shows the not-available card, its availability API answers 404,
// and the coach panel that suggested the link is gone. These guard against it being quietly reopened.
const page = readFileSync(new URL("../app/book/[coachId]/page.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/discovery-availability/[coachId]/route.ts", import.meta.url), "utf8");
const availability = readFileSync(new URL("../app/(coach)/groups/[groupId]/availability/page.tsx", import.meta.url), "utf8");

describe("old discovery-call page is closed", () => {
  it("the id link never renders the booking flow", () => {
    expect(page).not.toContain("DiscoveryBookingFlow");
    expect(page).toContain("isUuid(coachId) ? null");
  });
  it("the availability API answers 404 before doing any work", () => {
    expect(api).toContain("const CLOSED = true;");
    expect(api.indexOf("if (CLOSED)")).toBeGreaterThan(-1);
    expect(api.indexOf("if (CLOSED)")).toBeLessThan(api.indexOf("createServiceRoleClient()"));
  });
  it("the Availability page no longer shows the discovery panel or its link", () => {
    expect(availability).not.toContain("DiscoveryCallsPanel");
  });
});
