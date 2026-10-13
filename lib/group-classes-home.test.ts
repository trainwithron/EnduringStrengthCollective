import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// "Group classes this week" on the client's Home: the next seven days of the group's sessions, a handful, hidden when there are none, never for a one-on-one space, only for the person's own Home
// (joining uses the signed-in person). The Group sessions page and the Home share one loader.
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const hub = read("app/(coach)/groups/[groupId]/page.tsx");
const page = read("app/(coach)/groups/[groupId]/classes/page.tsx");
const loader = read("lib/class-cards.ts");

describe("group classes on the client Home", () => {
  it("loads seven days, five at most, only on the person's own Home and never in a one-on-one space", () => {
    expect(hub).toContain("untilIso: new Date(Date.now() + 7 * 86400000).toISOString(), limit: 5");
    expect(hub).toContain("athleteId === user.id");
    expect(hub).toContain('group_kind !== "one_on_one"');
  });
  it("is hidden when there is nothing to show, and uses the approved heading", () => {
    expect(hub).toContain("loaded.classes.length > 0");
    expect(hub).toContain("Group classes this week");
  });
  it("the Group sessions page and the Home use the same loader", () => {
    expect(page).toContain("loadClassCards(");
    expect(hub).toContain("loadClassCards(");
    expect(loader).toContain('.eq("kind", "class")');
  });
  it("lists only the classes of the group's own organization", () => {
    expect(loader).toContain('.eq("organization_id", organizationId)');
    expect(loader).toContain("orgIdOfGroup(supabase, groupId)");
  });
});
