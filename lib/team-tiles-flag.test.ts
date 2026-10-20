import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tileTeamsFor } from "@/lib/team-coach";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Ron's real rows: "The Enduring Strength Collective" (44444444-...) is group_kind 'team' with team_mode FALSE (a business organization's community group); the Trojans are the only team-sport group (team_mode TRUE).
const COLLECTIVE = { id: "44444444-4444-4444-4444-444444444444", name: "The Enduring Strength Collective", kind: "team", orgId: "org-esc" };
const TROJANS = { id: "d873ae03-cfe5-440f-bf28-32ea9f70a5b6", name: "Trojans", kind: "team", orgId: "org-trojans" };
const modes = new Map<string, boolean | null>([[COLLECTIVE.id, false], [TROJANS.id, true]]);

describe("football tiles are for team-sport groups only (team_mode ON), not for any group of kind 'team'", () => {
  it("the business organization's 'team' kind group with team_mode off gets no tiles", () => {
    expect(tileTeamsFor([COLLECTIVE], modes, "org-esc")).toEqual([]);
  });
  it("the Trojans (team_mode on) do", () => {
    expect(tileTeamsFor([TROJANS], modes, "org-trojans")).toEqual([{ id: TROJANS.id, name: "Trojans" }]);
  });
  it("only the open organization's, and a group whose mode is unknown or null is not a team sport", () => {
    expect(tileTeamsFor([COLLECTIVE, TROJANS], modes, "org-esc")).toEqual([]);
    expect(tileTeamsFor([TROJANS], modes, "org-esc")).toEqual([]);
    expect(tileTeamsFor([TROJANS], new Map(), "org-trojans")).toEqual([]);
    expect(tileTeamsFor([TROJANS], new Map([[TROJANS.id, null]]), "org-trojans")).toEqual([]);
    expect(tileTeamsFor([{ ...TROJANS, kind: "one_on_one" }], modes, null)).toEqual([]);
  });
  it("Home reads team_mode for the candidates and builds the tiles from it; a failed read shows no tiles", () => {
    const page = read("app/(coach)/dashboard/page.tsx");
    expect(page).toContain('select("id, team_mode")');
    expect(page).toContain("tileModeRows.error ? [] : tileTeamsFor(");
    expect(page).not.toContain('const tileTeams = coachedForOrg.filter((g) => g.kind === "team"');
  });
  it("the other football surfaces already follow team_mode (menus, phone home, hub, depth chart link)", () => {
    expect(read("components/coach/coach-desktop-shell.tsx")).toContain("isTeamSportGroup(teamMode)");
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("isTeamSportGroup(");
    expect(read("components/coach/mobile/coach-spot-hub.tsx")).toContain("isTeamSportGroup(");
  });
});
