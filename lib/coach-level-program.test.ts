import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A program started from a client's page is the coach's own (no client on it) until "Assign to [First]". Source-level guards so a later edit cannot quietly attach it to the client again.
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const newPage = read("app/(coach)/groups/[groupId]/programs/new/page.tsx");
const creator = read("components/coach/create-and-open-program.tsx");
const builderPage = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
const banner = read("components/coach/assign-to-client-banner.tsx");

describe("coach-level programs: built unattached, assigned later", () => {
  it("a program started from a client's page is made in the coach's own team or social group with no client", () => {
    expect(newPage).toContain("pickAnchorGroup(coached, null, here.orgId)");
    expect(newPage).toContain('library.kind !== "one_on_one"');
    expect(newPage).toContain("athleteId={forClient ? null : athleteId}");
    expect(newPage).toContain("groupId={targetGroupId}");
  });
  it("keeps the approved name and carries the client to the builder in the address", () => {
    expect(creator).toContain("${athleteFirstName}'s program");
    expect(creator).toContain('"New program"');
    expect(creator).toContain("forClient=${forClient.id}&clientGroup=${forClient.groupId}");
    expect(creator).toContain("athlete_id: athleteId");
    // a library (no-client) program is not active, so the group never sees it on Athlete Home; the assigned copy is live
    expect(creator).toContain("is_active: athleteId !== null");
  });
  it("the builder only offers the button for a client of a group this coach coaches, and only while the program has no client", () => {
    expect(builderPage).toContain("forClientId && clientGroupId && !data.athleteId");
    expect(builderPage).toContain('coachSeat?.role === "coach" && clientSeat?.role === "athlete"');
  });
  it("uses the approved strings", () => {
    expect(banner).toContain("Not assigned yet. {firstName} can&apos;t see this.");
    expect(banner).toContain("`Assign to ${firstName}`");
    expect(banner).toContain("Assigned to {firstName}.");
    expect(banner).toContain("Couldn't assign it. Try again.");
  });
});
