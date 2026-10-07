import { describe, it, expect } from "vitest";
import { CLIENTS_HREF, groupClientsDestination, membersHref, showsMembers } from "./coach-clients-nav";
import { pickCoachAnchor } from "./coach-anchor";

describe("Clients is always coach-level; Members belongs to a team or social group", () => {
  it("Home (coach-level): Clients only, no Members", () => {
    expect(CLIENTS_HREF).toBe("/clients");
    expect(showsMembers("team", true)).toBe(false);
    expect(showsMembers(null, true)).toBe(false);
  });
  it("inside a one-on-one client's space: Clients is still the full list, and there is no Members", () => {
    expect(CLIENTS_HREF).toBe("/clients");
    expect(showsMembers("one_on_one", false)).toBe(false);
    expect(groupClientsDestination("one_on_one", undefined)).toBe("coach-level");
    expect(groupClientsDestination("one_on_one", "members")).toBe("coach-level");
  });
  it("inside a team or social group: Clients is the full list and Members is that group's roster", () => {
    expect(showsMembers("team", false)).toBe(true);
    expect(showsMembers("social", false)).toBe(true);
    expect(membersHref("g1")).toBe("/groups/g1/clients?view=members");
    expect(groupClientsDestination("team", "members")).toBe("members");
    expect(groupClientsDestination("social", "members")).toBe("members");
    // The old URL on its own (bookmarks, how-tos, search) is the full list, not the group.
    expect(groupClientsDestination("team", undefined)).toBe("coach-level");
    expect(groupClientsDestination("team", "something-else")).toBe("coach-level");
  });
  it("an unknown group kind never shows Members", () => {
    expect(showsMembers(undefined, false)).toBe(false);
    expect(groupClientsDestination(null, "members")).toBe("coach-level");
  });
});

describe("the group a coach-level page anchors its rail on", () => {
  it("is the first team or social group by name, never a client's", () => {
    const groups = [
      { id: "s", name: "Alice (1-on-1)", kind: "one_on_one" as const },
      { id: "b", name: "Zebras", kind: "team" as const },
      { id: "a", name: "Aces", kind: "social" as const },
    ];
    expect(pickCoachAnchor(groups)?.id).toBe("a");
  });
  it("falls back to a one-on-one group when that is all the coach has, and to nothing for no groups", () => {
    expect(pickCoachAnchor([{ id: "s2", name: "Bea", kind: "one_on_one" }, { id: "s1", name: "Ann", kind: "one_on_one" }])?.id).toBe("s1");
    expect(pickCoachAnchor([])).toBeNull();
  });
});
