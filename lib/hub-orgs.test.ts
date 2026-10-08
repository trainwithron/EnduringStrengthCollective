import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hubOrgs, hubStartOrgId } from "./hub-orgs";
import type { CoachedGroup } from "./coach-groups";

const g = (id: string, name: string, orgId: string, orgName: string, kind: CoachedGroup["kind"] = "team"): CoachedGroup => ({ id, name, kind, orgId, orgName });
const groups: CoachedGroup[] = [
  g("a1", "Alpha Team", "A", "Enduring Strength Co."),
  g("a2", "Solo Sam", "A", "Enduring Strength Co.", "one_on_one"),
  g("b1", "Home Team", "B", "Coast2Coast Fitness"),
  g("c1", "Trojans", "C", "Lee County West Trojans"),
];

describe("which organizations the hub offers", () => {
  it("one entry per organization the coach coaches in, by name, each pointing at a team or social group, never a client's own", () => {
    const list = hubOrgs(groups, null);
    expect(list.map((o) => o.orgName)).toEqual(["Coast2Coast Fitness", "Enduring Strength Co.", "Lee County West Trojans"]);
    expect(list.find((o) => o.orgId === "A")?.anchorGroupId).toBe("a1");
  });
  it("a remembered group inside an organization is that organization's group", () => {
    const two = [...groups, g("a3", "Beta Team", "A", "Enduring Strength Co.")];
    expect(hubOrgs(two, "a3").find((o) => o.orgId === "A")?.anchorGroupId).toBe("a3");
  });
  it("offers no choice to a coach in a single organization", () => {
    expect(hubOrgs(groups.filter((x) => x.orgId === "A"), null)).toEqual([]);
    expect(hubOrgs([], null)).toEqual([]);
  });
});

describe("which organization the hub starts on", () => {
  it("is the one the organization switcher last chose (the memory Home uses), else the page's own", () => {
    expect(hubStartOrgId(groups, "c1", "a1")).toBe("C");
    expect(hubStartOrgId(groups, null, "b1")).toBe("B");
    expect(hubStartOrgId(groups, "a2", "b1")).toBe("B");
    expect(hubStartOrgId(groups, "gone", "a1")).toBe("A");
    expect(hubStartOrgId([], null, "x")).toBeNull();
  });
});

describe("the hub is wired to it", () => {
  const hub = readFileSync(join(__dirname, "..", "components/coach/mobile/coach-spot-hub.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("shows the dropdown in the header only for a coach in two or more organizations, and every tile follows the chosen group", () => {
    expect(hub).toContain("orgs.length >= 2");
    expect(hub).toContain('aria-label="Organization"');
    for (const t of ["SpotClientsGroupsPanel", "BusinessMiniDashboard", "CalendarMiniView", "SpotBuilderPanel", "ProgramMiniView", "QuickPaymentPanel"]) {
      expect(hub).toMatch(new RegExp(`<${t}[^>]*groupId=\{activeGroupId\}`));
    }
    expect(hub).not.toMatch(/<(SpotClientsGroupsPanel|BusinessMiniDashboard|CalendarMiniView|ProgramMiniView|QuickPaymentPanel)[^>]*groupId=\{groupId\}/);
  });
  it("remembers the choice the way the organization switcher does, and does not override a hub opened for one client", () => {
    expect(hub).toContain("LAST_WORKSPACE_GROUP_COOKIE");
    expect(hub).toContain("!initialAthleteId");
  });
  it("reads the organizations the first time the hub opens, not on every page", () => {
    expect(hub).toContain("if (!open || orgsRequested.current) return;");
  });
  it("closing the hub before the read finishes does not lose the organizations, and a failed read is tried again on the next open", () => {
    const start = hub.indexOf("if (!open || orgsRequested.current) return;");
    const end = hub.indexOf("}, [open, groupId, initialAthleteId]);");
    const effect = hub.slice(start, end);
    expect(effect).not.toContain("let cancelled");
    expect(effect).not.toContain("if (cancelled");
    expect(effect).not.toMatch(/return () =>/);
    expect(effect).toContain("orgsRequested.current = false");
  });
  it("the Clients tile follows the hub: its own organization memory and tabs are off inside the hub", () => {
    expect(hub).toMatch(/<SpotClientsGroupsPanel[^>]*fromHub/);
    const tile = readFileSync(join(__dirname, "..", "components/coach/mobile/spot-clients-groups-panel.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(tile).toContain("(fromHub ? [currentOrgId] : [remembered, currentOrgId])");
    expect(tile).toContain("orgs.length >= 2 && !fromHub");
    expect(tile).toMatch(/if \(fromHub\) return;\s*try \{\s*window\.localStorage\.setItem\(SELECTED_ORG_KEY/);
  });
});
