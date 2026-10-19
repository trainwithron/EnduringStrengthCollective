import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit, New coach: a client sees "No open hours on this day" with no next step, and a new coach's first phone screen has no way to add a client.
describe("a client facing a day with nothing to book", () => {
  it("is told to message the coach, with a button, on both day pages", () => {
    for (const f of ["app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("No open hours on this day. Message your coach to ask for a time.");
      expect(src, f).toContain("<MessageCoachLink groupId={params.groupId} />");
    }
    expect(read("components/athlete/message-coach-link.tsx")).toContain("/groups/${groupId}/messages");
  });
});

describe("a coach with no clients on the phone", () => {
  it("the Clients tile offers 'Add a client' when there is no client at all (not merely none shown)", () => {
    const panel = read("components/coach/mobile/spot-clients-groups-panel.tsx");
    expect(panel).toContain("{clients !== null && clients.length === 0 && !query.trim() && (");
    expect(panel).toContain("/clients?add=1");
    expect(panel).toContain("Add a {term(\"client\")}");
  });
});
