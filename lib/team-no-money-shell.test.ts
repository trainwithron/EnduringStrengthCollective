import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moneyHiddenFor, orgIsTeamOnly } from "@/lib/team-sport";
import { ShellListPanel } from "@/components/coach/desktop/shell-list-panel";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Ron's real shapes: Lee County West Trojans = an organization with ONE group, a team-sport group (team_mode true). Another coach has a mix of a team and individual clients.
const trojans = [{ team_mode: true }];
const mixed = [{ team_mode: true }, { team_mode: false }];

describe("ONE rule for where the money numbers are hidden in the coach shell", () => {
  it("the Trojans (all team-sport): hidden on the group's own page AND on every coach-level page (Home, Clients, Calendar, Programs)", () => {
    expect(orgIsTeamOnly(trojans)).toBe(true);
    expect(moneyHiddenFor({ coachLevel: false, groupIsTeamSport: true, orgTeamOnly: true })).toBe(true);
    // the screenshot: a coach-level page, where the shell used to ignore the group's team flag completely
    expect(moneyHiddenFor({ coachLevel: true, groupIsTeamSport: true, orgTeamOnly: true })).toBe(true);
  });
  it("a team group inside a MIXED organization: hidden on that group's own page, but a coach-level page keeps the business (they have individual clients)", () => {
    expect(orgIsTeamOnly(mixed)).toBe(false);
    expect(moneyHiddenFor({ coachLevel: false, groupIsTeamSport: true, orgTeamOnly: false })).toBe(true);
    expect(moneyHiddenFor({ coachLevel: true, groupIsTeamSport: true, orgTeamOnly: false })).toBe(false);
  });
  it("an ordinary coach keeps everything", () => {
    expect(moneyHiddenFor({ coachLevel: false, groupIsTeamSport: false, orgTeamOnly: false })).toBe(false);
    expect(moneyHiddenFor({ coachLevel: true, groupIsTeamSport: false, orgTeamOnly: false })).toBe(false);
  });
});

describe("the shell applies it itself, not page by page", () => {
  const shell = read("components/coach/coach-desktop-shell.tsx");
  it("reads whether the whole organization is team-sport next to the group's own flag, and passes ONE value down", () => {
    expect(shell).toContain('.from("groups").select("team_mode").eq("organization_id", orgId)');
    expect(shell).toContain("const moneyHidden = moneyHiddenFor({ coachLevel: !!coachLevel, groupIsTeamSport: isTeamSportGroup(teamMode), orgTeamOnly });");
    expect(shell).toContain("hideMoney={moneyHidden}");
    // the old per-case prop is gone
    expect(shell).not.toContain("teamSport={teamSport}");
  });
  it("the rail's Business icon (and its income hover widget) is left out where the money is hidden", () => {
    expect(shell).toContain('moneyHidden && "items" in e && e.label === "Business"');
  });
  it("the left panel ignores a Business view pinned earlier, in any group, and never renders the mini dashboard", () => {
    const panel = read("components/coach/desktop/shell-list-panel.tsx");
    expect(panel).toContain('hideMoney && pickedView === "business" ? "roster" : pickedView');
    expect(panel).toContain('view === "business" && !hideMoney && <BusinessMiniDashboard');
    expect(panel).not.toContain("teamSport");
  });
  it("the Clients page renders the panel only through the shell (no page passes its own flag)", () => {
    expect(read("components/coach/coach-desktop-shell.tsx").match(/<ShellListPanel/g)?.length).toBe(1);
  });
});

describe("the left panel on the Trojans' page", () => {
  const props = { coachId: "c1", groupId: "g1", groupName: "TROJANS", sectionLabel: null, sectionSubLinks: [] };
  it("with the money hidden there is no Business tile, no whole-organization money tiles and no Go deeper", () => {
    const html = renderToStaticMarkup(createElement(ShellListPanel, { ...props, hideMoney: true }));
    expect(html).not.toMatch(/Business/);
    expect(html).not.toMatch(/WHOLE ORGANIZATION|Whole organization|Go deeper|MRR|Paying clients|Income/i);
    expect(html).toContain("grid-cols-3");
    expect(html).toContain("Clients");
    expect(html).toContain("Calendar");
  });
  it("for an ordinary coach the Business tile is still there", () => {
    const html = renderToStaticMarkup(createElement(ShellListPanel, { ...props }));
    expect(html).toContain("Business");
    expect(html).toContain("grid-cols-2");
  });
});
