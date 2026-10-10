import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeOrgId, clientCountsByOrg, inActiveOrg, rememberedOrgId } from "./active-org";
import type { CoachedGroup } from "./coach-groups";

// A coach who owns three separate organizations (three businesses).
const g = (id: string, name: string, orgId: string, kind: CoachedGroup["kind"] = "team"): CoachedGroup => ({ id, name, kind, orgId, orgName: `Org ${orgId}` });
const groups: CoachedGroup[] = [
  g("a1", "Alpha Team", "A"),
  g("a2", "Alpha Solo", "A", "one_on_one"),
  g("b1", "Beta Team", "B"),
  g("c1", "Coast Team", "C"),
];

describe("the active organization", () => {
  it("is the organization of the workspace group the coach last chose", () => {
    expect(activeOrgId(groups, "b1")).toBe("B");
    expect(activeOrgId(groups, "c1")).toBe("C");
  });
  it("falls back to the organization of their first team or social group, when nothing is remembered or the remembered group is gone", () => {
    expect(activeOrgId(groups, null)).toBe("A");
    expect(activeOrgId(groups, "deleted-group")).toBe("A");
  });
  it("with nothing remembered, takes the organization with the most clients, however the group names sort (three organizations, all owned)", () => {
    expect(activeOrgId(groups, null, { A: 2, B: 9, C: 4 })).toBe("B");
    expect(activeOrgId(groups, "gone", { A: 2, B: 3, C: 11 })).toBe("C");
    expect(activeOrgId(groups, null, { A: 13, B: 3, C: 11 })).toBe("A");
  });
  it("what they last used wins over the biggest organization", () => {
    expect(activeOrgId(groups, "c1", { A: 50, B: 9, C: 1 })).toBe("C");
    expect(rememberedOrgId(groups, "b1")).toBe("B");
    expect(rememberedOrgId(groups, "a2")).toBeNull();
    expect(rememberedOrgId(groups, "gone")).toBeNull();
    expect(rememberedOrgId(groups, null)).toBeNull();
  });
  it("a tie, or no client counts at all, falls back to the first team or social group by name", () => {
    expect(activeOrgId(groups, null, { A: 5, B: 5, C: 1 })).toBe("A");
    expect(activeOrgId(groups, null, {})).toBe("A");
  });
  it("never anchors on a client's own one-on-one group", () => {
    expect(activeOrgId(groups, "a2")).toBe("A");
    expect(activeOrgId([g("x2", "Solo", "X", "one_on_one"), g("y1", "Team Y", "Y")], "x2")).toBe("Y");
  });
  it("a coach with nothing has no active organization", () => {
    expect(activeOrgId([], null)).toBeNull();
  });
});

describe("counting each organization's clients", () => {
  const fakeDb = (rows: unknown[], error: unknown = null) =>
    ({
      from: () => {
        const self: any = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (r: (v: unknown) => void) => r({ data: error ? null : rows, error }) : () => self) });
        return self;
      },
    }) as never;
  it("counts each client once per organization, even in two of its groups, and counts a client in two organizations in both", async () => {
    const gs = [g("a1", "A1", "A"), g("a3", "A3", "A"), g("b1", "B1", "B")];
    const counts = await clientCountsByOrg(fakeDb([{ group_id: "a1", profile_id: "p1" }, { group_id: "a3", profile_id: "p1" }, { group_id: "a3", profile_id: "p2" }, { group_id: "b1", profile_id: "p1" }]), gs);
    expect(counts).toEqual({ A: 2, B: 1 });
  });
  it("gives no counts when the read fails, and none for a coach with no groups", async () => {
    expect(await clientCountsByOrg(fakeDb([], { message: "boom" }), groups)).toEqual({});
    expect(await clientCountsByOrg(fakeDb([]), [])).toEqual({});
  });
});

describe("keeping only the active organization's groups", () => {
  const rows = [
    { id: "a1", organization_id: "A" },
    { id: "a2", organization_id: "A" },
    { id: "b1", organization_id: "B" },
    { id: "c1", organization_id: "C" },
  ];
  it("shows nothing from the other two organizations, and switching shows the others", () => {
    expect(inActiveOrg(rows, "A").map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(inActiveOrg(rows, "B").map((r) => r.id)).toEqual(["b1"]);
    expect(inActiveOrg(rows, "C").map((r) => r.id)).toEqual(["c1"]);
  });
  it("keeps everything when there is no active organization to scope to", () => {
    expect(inActiveOrg(rows, null)).toHaveLength(4);
  });
  it("a client in two organizations counts in each (each organization has its own membership for them)", () => {
    const memberships = [{ id: "a1", organization_id: "A" }, { id: "b1", organization_id: "B" }];
    expect(inActiveOrg(memberships, "A")).toHaveLength(1);
    expect(inActiveOrg(memberships, "B")).toHaveLength(1);
  });
});

describe("Home is scoped to the active organization everywhere", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
  const page = read("app/(coach)/dashboard/page.tsx");
  it("reads the organization switcher's choice and keeps only that organization's groups before anything is counted", () => {
    expect(page).toContain("LAST_WORKSPACE_GROUP_COOKIE");
    expect(page).toContain("activeOrgId(coachedForOrg, rememberedWorkspace, clientsByOrg)");
    expect(page).toContain("clientCountsByOrg(supabase, coachedForOrg)");
    expect(page.indexOf("inActiveOrg([g], homeOrgId)")).toBeGreaterThan(-1);
    expect(page.indexOf("inActiveOrg([g], homeOrgId)")).toBeLessThan(page.indexOf("const allGroups = [...byId.values()]"));
    expect(page.indexOf("const allGroups = [...byId.values()]")).toBeLessThan(page.indexOf("getCoachDashboardData(supabase"));
  });
  it("only administers the active organization's groups from the admin list", () => {
    expect(page).toContain(".filter((id) => !homeOrgId || id === homeOrgId)");
  });
  it("hands the active organization's groups to every panel that reads on its own", () => {
    for (const p of ["LateChangesPanel", "ScheduleRequestsPanel", "ExpiryCheckInPanel", "InactiveClientsPanel", "ProgressLookPanel"]) {
      expect(page).toContain(`<${p} groupIds={allGroupIds} />`);
    }
  });
  it("each of those panels stays inside the groups it is given (and still works unscoped elsewhere)", () => {
    expect(read("components/coach/late-changes-panel.tsx")).toContain('.in("group_id", scopeGroupIds)');
    expect(read("components/coach/schedule-requests-panel.tsx")).toContain('.in("group_id", scopeGroupIds)');
    expect(read("components/coach/expiry-checkin-panel.tsx")).toContain("scopeGroupIds.includes(id)");
    expect(read("components/coach/inactive-clients-panel.tsx")).toContain("scopeGroupIds.includes(id)");
    expect(read("components/coach/progress-look-panel.tsx")).toContain("scopeGroupIds.includes(c.groupId)");
    for (const f of ["late-changes-panel", "schedule-requests-panel", "expiry-checkin-panel", "inactive-clients-panel", "progress-look-panel"]) {
      expect(read(`components/coach/${f}.tsx`)).toContain("[scopeKey]");
    }
  });
  it("the briefing's items are limited to the active organization's groups", () => {
    expect(page).toContain("collectiveIntelligenceItems.filter((i) => !i.groupId || allGroupIds.includes(i.groupId))");
  });
  it("the Spotter list and the Right now box are gone from Home (they were copies), and the other boxes stay", () => {
    expect(page).not.toContain("<CollectiveIntelligencePanel");
    expect(page).not.toContain("<DashboardHero");
    for (const keep of ["<NeedsYouLoader", "<YourDayPanel", "<PulseTabs", "<DashboardTileGrid", "<NeedsReplyPanel", "<OrgNotificationsPanel", "<NeedsPaymentPanel"]) expect(page).toContain(keep);
  });
});
