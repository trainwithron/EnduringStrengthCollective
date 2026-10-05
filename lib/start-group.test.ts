import { describe, expect, it } from "vitest";
import { parseLastGroupCookie, pickStartGroup, type StartMembership } from "./start-group";

const m = (group_id: string, role: string, joined_at: string, group_kind: string | null = "team"): StartMembership => ({
  group_id,
  role,
  joined_at,
  group_kind,
});

describe("pickStartGroup", () => {
  it("returns null with no memberships", () => {
    expect(pickStartGroup({ memberships: [] })).toBeNull();
  });

  it("a coach never starts in a client's one-on-one group when a real group exists", () => {
    const pick = pickStartGroup({
      memberships: [m("solo", "coach", "2026-01-01", "one_on_one"), m("team", "coach", "2026-02-01", "team")],
    });
    expect(pick?.group_id).toBe("team");
  });

  it("a coach is not sent to a group where they are only an athlete", () => {
    const pick = pickStartGroup({ memberships: [m("a", "athlete", "2026-01-01"), m("c", "coach", "2026-03-01")] });
    expect(pick?.group_id).toBe("c");
  });

  it("prefers the last place worked, then is stable by join date", () => {
    const memberships = [m("g2", "coach", "2026-02-01"), m("g1", "coach", "2026-01-01")];
    expect(pickStartGroup({ memberships, lastGroupId: "g2" })?.group_id).toBe("g2");
    expect(pickStartGroup({ memberships })?.group_id).toBe("g1");
    expect(pickStartGroup({ memberships: [...memberships].reverse() })?.group_id).toBe("g1");
  });

  it("ignores a last group that is a one-on-one group when a shared one exists", () => {
    const memberships = [m("solo", "coach", "2026-01-01", "one_on_one"), m("team", "coach", "2026-02-01")];
    expect(pickStartGroup({ memberships, lastGroupId: "solo" })?.group_id).toBe("team");
  });

  it("a coach with only one-on-one groups still lands somewhere, deterministically", () => {
    const memberships = [m("s2", "coach", "2026-02-01", "one_on_one"), m("s1", "coach", "2026-01-01", "one_on_one")];
    expect(pickStartGroup({ memberships })?.group_id).toBe("s1");
  });

  it("an athlete lands where they were last active, else last place, else the newest join", () => {
    const memberships = [m("old", "athlete", "2026-01-01"), m("new", "athlete", "2026-05-01")];
    expect(pickStartGroup({ memberships, recentActivityGroupId: "old" })?.group_id).toBe("old");
    expect(pickStartGroup({ memberships, lastGroupId: "old" })?.group_id).toBe("old");
    expect(pickStartGroup({ memberships })?.group_id).toBe("new");
    expect(pickStartGroup({ memberships, recentActivityGroupId: "not-mine" })?.group_id).toBe("new");
  });
});

describe("parseLastGroupCookie", () => {
  it("reads the id and survives junk", () => {
    expect(parseLastGroupCookie(encodeURIComponent(JSON.stringify({ id: "abc" })))).toBe("abc");
    expect(parseLastGroupCookie("%%%")).toBeNull();
    expect(parseLastGroupCookie(undefined)).toBeNull();
  });
});
