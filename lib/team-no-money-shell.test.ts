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
  it("the Business tab (and the income hover widget on Home) is left out where the money is hidden (FIX 6)", () => {
    // no money hover on Home's icon for anyone: money is on the Business tab only (clutter audit DK29, Nov 21)
    expect(shell).not.toContain("BusinessRailWidget");
    expect(read("lib/desktop-coach-homes.ts")).toContain('const MONEY_TABS = new Set(["business",');
  });
  it("the left panel ignores a Business view pinned earlier, in any group, and never renders the mini dashboard", () => {
    const panel = read("components/coach/desktop/shell-list-panel.tsx");
    expect(panel).toContain('hideMoney && pickedView === "business" ? "roster" : pickedView');
    // the half shows the view that survived that rule, so a team never gets the Business page there either
    expect(panel).toContain("<SplitHalfSlot view={view} groupId={groupId} covered={dragging} />");
    expect(panel).not.toContain("BusinessMiniDashboard");
    expect(panel).not.toContain("teamSport");
  });
  it("the Clients page renders the panel only through the shell (no page passes its own flag)", () => {
    expect(read("components/coach/coach-desktop-shell.tsx").match(/<ShellListPanel/g)?.length).toBe(1);
  });
});

describe("the left panel on the Trojans' page", () => {
  const props = { coachId: "c1", groupId: "g1", groupName: "TROJANS" };
  // The panel starts closed (clutter audit DK4, Nov 21), so its first render is the open tab alone; the tiles are read from the source.
  const panel = read("components/coach/desktop/shell-list-panel.tsx");
  it("it first renders closed, with nothing but the tab that opens it (no money anywhere)", () => {
    for (const hideMoney of [true, false]) {
      const html = renderToStaticMarkup(createElement(ShellListPanel, { ...props, hideMoney }));
      expect(html).toContain('aria-label="Expand panel"');
      expect(html).not.toMatch(/Business|WHOLE ORGANIZATION|Whole organization|Go deeper|MRR|Paying clients|Income/i);
    }
  });
  it("with the money hidden there is no Business tile (three tiles); an ordinary coach has it (two by two); no emoji on the tiles", () => {
    expect(panel).toContain('grid ${hideMoney ? "grid-cols-3" : "grid-cols-2"} gap-1 mb-2');
    expect(panel).toContain("{!hideMoney && (\n          <button");
    for (const label of ["Business", "Calendar", "Program"]) expect(panel).toContain(`            ${label}\n          </button>`);
    expect(panel).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
