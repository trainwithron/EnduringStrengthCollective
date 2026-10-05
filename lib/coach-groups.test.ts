import { describe, expect, it } from "vitest";
import { coachedOrgs, groupsInOrgOf, pickAnchorGroup, type CoachedGroup } from "@/lib/coach-groups";

const g = (id: string, kind: CoachedGroup["kind"], orgId = "o1", orgName = "Org One"): CoachedGroup => ({
  id,
  name: id,
  kind,
  orgId,
  orgName,
});

const groups = [g("solo-a", "one_on_one"), g("team-a", "team"), g("social-a", "social"), g("team-b", "team", "o2", "Org Two")];

describe("groupsInOrgOf", () => {
  it("returns only the coached groups in the same org as the page's group", () => {
    expect(groupsInOrgOf(groups, "solo-a").map((x) => x.id)).toEqual(["solo-a", "team-a", "social-a"]);
    expect(groupsInOrgOf(groups, "team-b").map((x) => x.id)).toEqual(["team-b"]);
  });

  it("is empty for a group the coach doesn't coach", () => {
    expect(groupsInOrgOf(groups, "nope")).toEqual([]);
  });
});

describe("coachedOrgs", () => {
  it("lists each org once", () => {
    expect(coachedOrgs(groups).map((o) => o.id)).toEqual(["o1", "o2"]);
  });
});

describe("pickAnchorGroup", () => {
  it("uses the remembered group when it is still theirs and not one-on-one", () => {
    expect(pickAnchorGroup(groups, "social-a")?.id).toBe("social-a");
  });

  it("never anchors on a one-on-one group, even if it was remembered", () => {
    expect(pickAnchorGroup(groups, "solo-a")?.id).toBe("team-a");
  });

  it("falls back to the first team/social group, and ignores a forgotten or foreign id", () => {
    expect(pickAnchorGroup(groups, "gone")?.id).toBe("team-a");
    expect(pickAnchorGroup(groups, null)?.id).toBe("team-a");
  });

  it("prefers the requested org", () => {
    expect(pickAnchorGroup(groups, "team-a", "o2")?.id).toBe("team-b");
  });

  it("a coach with only one-on-one clients still gets a placeholder anchor", () => {
    expect(pickAnchorGroup([g("solo-a", "one_on_one"), g("solo-b", "one_on_one")], "solo-b")?.id).toBe("solo-a");
  });

  it("returns null when the coach has no groups", () => {
    expect(pickAnchorGroup([], null)).toBeNull();
  });
});
