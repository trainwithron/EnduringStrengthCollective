import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEAM_COACH_HIDDEN_NAV, hiddenForCoachType, teamHomeTiles } from "./team-coach";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the team coach's menus and Home", () => {
  it("a team coach does not see the tools for selling to clients; nobody else loses anything", () => {
    for (const key of ["resources", "website", "availability", "session-types", "booking-page", "leads", "session-ledger"]) {
      expect(hiddenForCoachType("team", key), key).toBe(true);
      expect(hiddenForCoachType("personal", key), key).toBe(false);
      expect(hiddenForCoachType("gym", key), key).toBe(false);
      expect(hiddenForCoachType(null, key), key).toBe(false);
    }
    // what a team coach still needs stays
    for (const key of ["business", "packages", "waiver", "branding", "settings", "kiosk", "display", "team", "attendance", "programs"]) expect(hiddenForCoachType("team", key), key).toBe(false);
    expect(TEAM_COACH_HIDDEN_NAV.size).toBe(7);
  });

  it("the team Home has a tile for the roster, the depth chart, practices and games, attendance, the weight room and the TV display", () => {
    const tiles = teamHomeTiles("g1");
    expect(tiles.map((t) => t.key)).toEqual(["roster", "depth", "calendar", "attendance", "weight-room", "tv"]);
    expect(tiles.find((t) => t.key === "roster")!.href).toBe("/groups/g1/clients?view=members");
    expect(tiles.find((t) => t.key === "depth")!.href).toBe("/groups/g1/team");
    expect(tiles.find((t) => t.key === "calendar")!.href).toBe("/groups/g1/team/calendar");
    expect(tiles.find((t) => t.key === "weight-room")!.href).toBe("/groups/g1/kiosk");
    expect(tiles.find((t) => t.key === "tv")).toMatchObject({ href: "/groups/g1/display", newTab: true });
  });

  it("every tile points at a page that exists", () => {
    for (const path of ["team/page.tsx", "team/calendar", "attendance/page.tsx", "kiosk/page.tsx", "display/page.tsx"]) {
      expect(() => readFileSync(join(__dirname, "..", "app/(coach)/groups/[groupId]", path.endsWith(".tsx") ? path : `${path}/page.tsx`), "utf8"), path).not.toThrow();
    }
  });

  it("the desktop menu and the phone menu both apply it, and Home shows the tiles only to a team coach", () => {
    expect(src("components/coach/coach-desktop-shell.tsx")).toContain("hiddenForCoachType(coachType, i.key)");
    const phone = src("components/coach/mobile/coach-nav-links-list.tsx");
    for (const key of ["availability", "booking-page", "session-types", "session-ledger", "leads", "resources"]) expect(phone, key).toContain(`hiddenForCoachType(coachType, "${key}")`);
    const home = src("app/(coach)/dashboard/page.tsx");
    expect(home).toContain('coach_type?: string | null } | null)?.coach_type === "team"');
    expect(home).toContain("{isTeamCoach && teamGroups[0] && <TeamCoachHome");
  });

  it("a coach whose type is unknown (never asked, or a failed read) keeps the menus exactly as they were", () => {
    const hook = src("components/coach/use-coach-type.ts");
    expect(hook).toContain("return isCoachType(value) ? value : null;");
    expect(hook).toContain("catch {\n        return null;");
  });
});
