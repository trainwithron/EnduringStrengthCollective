import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("inactive clients: wiring and safety", () => {
  const panel = read("../components/coach/inactive-clients-panel.tsx");
  it("the card is shown on the desktop dashboard and the phone home, next to the expiry check-in", () => {
    expect(read("../app/(coach)/dashboard/page.tsx")).toContain("<InactiveClientsPanel />");
    expect(read("../components/coach/mobile/coach-mobile-home.tsx")).toContain("<InactiveClientsPanel />");
  });
  it("only the coach's own button sets a client aside, through the one function, and nothing is sent by the panel", () => {
    expect(panel).toContain("set_client_inactive");
    expect(panel).not.toContain("direct_messages\").insert");
    expect(panel.match(/set_client_inactive/g)?.length).toBe(1);
  });
  it("uses neutral wording and offers the coach every answer", () => {
    expect(panel).toContain("Door open, or set aside?");
    for (const label of ["Send a door-open note", "Set aside as inactive", "Keep active", "Not now"]) expect(panel).toContain(label);
    expect(panel).not.toMatch(/unresponsive|lazy|ghost|bad client/i);
  });
  it("stays quiet before the database update (a failed lookup returns without showing anything)", () => {
    expect(panel).toContain("if (asideError) return;");
    expect(read("../lib/inactive-ids.ts")).toContain("if (error) return new Set();");
  });
  it("a client set aside is left out of the dashboard counts and cards, and the profile has the control", () => {
    expect(read("../lib/dashboard-data.ts")).toContain("inactiveKeys.has(inactiveKey(row.group_id, row.profile_id))");
    expect(read("../app/(coach)/dashboard/page.tsx")).toContain("inactiveKeys.has(inactiveKey(row.group_id, row.profile_id))");
    expect(read("../app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("<SetAsideControl");
  });
});
