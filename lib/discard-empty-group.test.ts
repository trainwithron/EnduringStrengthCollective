import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DISCARD_WINDOW_MS, discardRefusal, type DiscardFacts } from "@/lib/discard-empty-group";

const now = new Date("2026-10-16T12:00:00Z");
const fresh: DiscardFacts = { createdBy: "me", createdAt: "2026-10-16T11:30:00Z", groupKind: "one_on_one", otherMembers: 0, athleteMembers: 0, hasContent: false };

describe("discarding a group that was just made and never used", () => {
  it("is allowed for my own new empty group", () => {
    expect(discardRefusal(fresh, "me", now)).toBeNull();
  });
  it("is refused for someone else's group, an old group, a group with a client or anyone else, or one with things in it", () => {
    expect(discardRefusal(fresh, "someone-else", now)).toBe("Only the person who made a group can discard it.");
    expect(discardRefusal({ ...fresh, createdBy: null }, "me", now)).toBe("Only the person who made a group can discard it.");
    expect(discardRefusal({ ...fresh, createdAt: new Date(now.getTime() - DISCARD_WINDOW_MS - 1000).toISOString() }, "me", now)).toBe("That group is not new any more.");
    expect(discardRefusal({ ...fresh, createdAt: null }, "me", now)).toBe("That group is not new any more.");
    expect(discardRefusal({ ...fresh, athleteMembers: 1, otherMembers: 1 }, "me", now)).toBe("That group has people in it.");
    expect(discardRefusal({ ...fresh, otherMembers: 1 }, "me", now)).toBe("That group has people in it.");
    expect(discardRefusal({ ...fresh, hasContent: true }, "me", now)).toBe("That group already has things in it.");
  });
  it("the route checks the signed-in person, reads the facts with the service role, refuses with 409 and only then deletes", () => {
    const route = readFileSync(join(__dirname, "..", "app/api/groups/discard-empty/route.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(route).toContain('{ error: "Not authenticated" }, { status: 401 }');
    expect(route).toContain("discardRefusal(");
    expect(route).toContain("{ status: 409 }");
    expect(route.indexOf("discardRefusal(")).toBeLessThan(route.indexOf('.from("groups").delete()'));
    expect(route).toContain("createServiceRoleClient()");
  });
});
